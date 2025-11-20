use std::thread;
use std::time::{SystemTime, Instant, Duration};
use std::fs;
use std::io::BufWriter;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};
use rdev::{listen, EventType, Button};
use xcap::Monitor;
use image::codecs::jpeg::JpegEncoder;
use image::Rgb;
use imageproc::drawing::{draw_filled_circle_mut, draw_hollow_circle_mut};
use std::sync::mpsc;
use crate::accessibility::{get_element_at_point, ElementInfo};

static SCREENSHOT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, serde::Serialize)]
struct Step {
    type_: String,
    x: Option<f64>,
    y: Option<f64>,
    text: Option<String>,
    timestamp: u64,
    screenshot: Option<String>, // File path to screenshot
    element_name: Option<String>,
    element_type: Option<String>,
    element_value: Option<String>,
    app_name: Option<String>,
}

pub struct RecordingState {
    pub is_recording: std::sync::Arc<std::sync::Mutex<bool>>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            is_recording: std::sync::Arc::new(std::sync::Mutex::new(false)),
        }
    }
}

enum RecorderEvent {
    Click { x: f64, y: f64 },
    Key { key: rdev::Key, text: Option<String> },
}

struct CaptureData {
    x: Option<f64>,
    y: Option<f64>,
    image: image::DynamicImage,
    timestamp: u64,
    step_type: String,
    text: Option<String>,
    element_info: Option<ElementInfo>,
}

// Find the monitor that contains the given point
fn get_monitor_at_point(x: f64, y: f64) -> Option<Monitor> {
    Monitor::all().ok()?.into_iter().find(|m| {
        let mx = m.x() as f64;
        let my = m.y() as f64;
        let mw = m.width() as f64;
        let mh = m.height() as f64;
        x >= mx && x < mx + mw && y >= my && y < my + mh
    })
}

pub fn start_listener(app: AppHandle, is_recording: std::sync::Arc<std::sync::Mutex<bool>>) {
    // Channel 1: Listener -> Capture Logic
    let (tx_event, rx_event) = mpsc::channel::<RecorderEvent>();

    // Channel 2: Capture Logic -> Encoder
    let (tx_encode, rx_encode) = mpsc::channel::<CaptureData>();

    let app_clone = app.clone();

    // Thread 3: Encoder/Emitter (Write to temp files - much faster than base64)
    thread::spawn(move || {
        // Create temp directory for screenshots
        let temp_dir = std::env::temp_dir().join("openscribe_screenshots");
        let _ = fs::create_dir_all(&temp_dir);

        for data in rx_encode {
            let mut rgb_image = data.image.to_rgb8();

            // Draw click highlight if this is a click step
            if data.step_type == "click" {
                if let (Some(x), Some(y)) = (data.x, data.y) {
                    let cx = x as i32;
                    let cy = y as i32;

                    // Colors for highlight
                    let outer_color = Rgb([255u8, 69u8, 0u8]); // Orange-red
                    let inner_color = Rgb([255u8, 0u8, 0u8]);   // Red

                    // Draw outer ring (multiple circles for thickness)
                    for r in 30..=35 {
                        draw_hollow_circle_mut(&mut rgb_image, (cx, cy), r, outer_color);
                    }

                    // Draw inner filled dot
                    draw_filled_circle_mut(&mut rgb_image, (cx, cy), 5, inner_color);
                }
            }

            // Generate unique filename
            let counter = SCREENSHOT_COUNTER.fetch_add(1, Ordering::SeqCst);
            let filename = format!("screenshot_{}_{}.jpg", data.timestamp, counter);
            let file_path = temp_dir.join(&filename);

            // Write directly to file (faster than base64 encoding + memory)
            let screenshot_path = if let Ok(file) = fs::File::create(&file_path) {
                let mut writer = BufWriter::new(file);
                let mut encoder = JpegEncoder::new_with_quality(&mut writer, 85);

                if encoder.encode_image(&rgb_image).is_ok() {
                    Some(file_path.to_string_lossy().to_string())
                } else {
                    None
                }
            } else {
                None
            };

            let step = Step {
                type_: data.step_type,
                x: data.x,
                y: data.y,
                text: data.text,
                timestamp: data.timestamp,
                screenshot: screenshot_path,
                element_name: data.element_info.as_ref().map(|e| e.name.clone()),
                element_type: data.element_info.as_ref().map(|e| e.element_type.clone()),
                element_value: data.element_info.as_ref().and_then(|e| e.value.clone()),
                app_name: data.element_info.as_ref().and_then(|e| e.app_name.clone()),
            };

            let _ = app_clone.emit("new-step", step);
        }
    });

    // Thread 2: Capture Logic (State machine + Fast Capture)
    let is_recording_capture = is_recording.clone();
    thread::spawn(move || {
        let mut key_buffer = String::new();
        let mut last_key_time: Option<Instant> = None;
        let mut last_click_time: Option<Instant> = None;
        let mut last_click_pos: (f64, f64) = (0.0, 0.0);

        let text_flush_timeout = Duration::from_millis(1500);
        let click_debounce = Duration::from_millis(150);
        let click_distance_threshold = 10.0;

        loop {
            // Use timeout to check for text buffer flush
            let event = rx_event.recv_timeout(Duration::from_millis(100));

            let recording = *is_recording_capture.lock().unwrap();
            if !recording {
                key_buffer.clear();
                last_key_time = None;
                continue; // Skip all events when not recording
            }

            // Check if we need to flush text buffer due to timeout
            if let Some(last_time) = last_key_time {
                if last_time.elapsed() >= text_flush_timeout && !key_buffer.is_empty() {
                    // Get monitor at last click position (where user is typing)
                    if let Some(mon) = get_monitor_at_point(last_click_pos.0, last_click_pos.1) {
                        if let Ok(image) = mon.capture_image() {
                            let _ = tx_encode.send(CaptureData {
                                x: None,
                                y: None,
                                image: image::DynamicImage::ImageRgba8(image),
                                timestamp: SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                                step_type: "type".to_string(),
                                text: Some(key_buffer.clone()),
                                element_info: None,
                            });
                            key_buffer.clear();
                            last_key_time = None;
                        }
                    }
                }
            }

            let event = match event {
                Ok(e) => e,
                Err(_) => continue, // Timeout, loop back to check text flush
            };

            match event {
                RecorderEvent::Key { key, text } => {
                    let is_return = key == rdev::Key::Return;
                    let is_tab = key == rdev::Key::Tab;

                    if let Some(t) = text {
                        // Filter out control characters from text representation if needed
                        if t.len() == 1 {
                             key_buffer.push_str(&t);
                             last_key_time = Some(Instant::now());
                        } else if t == "Space" {
                            key_buffer.push(' ');
                            last_key_time = Some(Instant::now());
                        }
                    }

                    if is_return {
                        key_buffer.push('\n');
                        last_key_time = Some(Instant::now());
                    }

                    // Flush on Return or Tab
                    if (is_return || is_tab) && !key_buffer.is_empty() {
                        // Get monitor at last click position (where user is typing)
                        if let Some(mon) = get_monitor_at_point(last_click_pos.0, last_click_pos.1) {
                            if let Ok(image) = mon.capture_image() {
                                let _ = tx_encode.send(CaptureData {
                                    x: None,
                                    y: None,
                                    image: image::DynamicImage::ImageRgba8(image),
                                    timestamp: SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                                    step_type: "type".to_string(),
                                    text: Some(key_buffer.clone()),
                                    element_info: None,
                                });
                                key_buffer.clear();
                                last_key_time = None;
                            }
                        }
                    }
                }
                RecorderEvent::Click { x, y } => {
                    // Click debouncing: ignore if too close in time and position
                    let now = Instant::now();
                    if let Some(last_time) = last_click_time {
                        let time_diff = now.duration_since(last_time);
                        let distance = ((x - last_click_pos.0).powi(2) + (y - last_click_pos.1).powi(2)).sqrt();

                        if time_diff < click_debounce && distance < click_distance_threshold {
                            continue; // Skip this click (debounced)
                        }
                    }
                    last_click_time = Some(now);
                    last_click_pos = (x, y);

                    // Get element info at click point using accessibility APIs
                    let element_info = get_element_at_point(x, y);

                    // Capture Screenshot from the correct monitor
                    if let Some(mon) = get_monitor_at_point(x, y) {
                        if let Ok(image) = mon.capture_image() {
                            let timestamp = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;

                            // 1. Flush text if any (using the same screenshot)
                            if !key_buffer.is_empty() {
                                let _ = tx_encode.send(CaptureData {
                                    x: None,
                                    y: None,
                                    image: image::DynamicImage::ImageRgba8(image.clone()), // Clone for text step
                                    timestamp,
                                    step_type: "type".to_string(),
                                    text: Some(key_buffer.clone()),
                                    element_info: None,
                                });
                                key_buffer.clear();
                                last_key_time = None;
                            }

                            // 2. Emit Click Step with element info
                            let _ = tx_encode.send(CaptureData {
                                x: Some(x),
                                y: Some(y),
                                image: image::DynamicImage::ImageRgba8(image), // Move for click step
                                timestamp,
                                step_type: "click".to_string(),
                                text: None,
                                element_info,
                            });
                        }
                    }
                }
            }
        }
    });

    // Thread 1: Input Listener (Must be non-blocking / fast)
    thread::spawn(move || {
        let mut current_x = 0.0;
        let mut current_y = 0.0;

        if let Err(error) = listen(move |event| {
            match event.event_type {
                EventType::MouseMove { x, y } => {
                    current_x = x;
                    current_y = y;
                }
                EventType::ButtonPress(Button::Left) => {
                    let _ = tx_event.send(RecorderEvent::Click { x: current_x, y: current_y });
                }
                EventType::KeyPress(key) => {
                    let _ = tx_event.send(RecorderEvent::Key { key, text: event.name });
                }
                _ => {}
            }
        }) {
            println!("Error: {:?}", error)
        }
    });
}
