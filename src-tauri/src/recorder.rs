use std::thread;
use std::time::{SystemTime, Instant, Duration};
use tauri::{AppHandle, Emitter};
use rdev::{listen, EventType, Button};
use xcap::Monitor;
use std::io::Cursor;
use base64::{Engine as _, engine::general_purpose};
use image::codecs::jpeg::JpegEncoder;
use std::sync::mpsc;

#[derive(Clone, serde::Serialize)]
struct Step {
    type_: String,
    x: Option<f64>,
    y: Option<f64>,
    text: Option<String>,
    timestamp: u64,
    screenshot: Option<String>, // Base64 encoded
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
}

pub fn start_listener(app: AppHandle, is_recording: std::sync::Arc<std::sync::Mutex<bool>>) {
    // Channel 1: Listener -> Capture Logic
    let (tx_event, rx_event) = mpsc::channel::<RecorderEvent>();
    
    // Channel 2: Capture Logic -> Encoder
    let (tx_encode, rx_encode) = mpsc::channel::<CaptureData>();

    let app_clone = app.clone();

    // Thread 3: Encoder/Emitter (Heavy lifting: JPEG encoding - much faster than PNG)
    thread::spawn(move || {
        for data in rx_encode {
            let mut buffer = Cursor::new(Vec::new());
            let rgb_image = data.image.to_rgb8();
            let mut encoder = JpegEncoder::new_with_quality(&mut buffer, 85);

            if encoder.encode_image(&rgb_image).is_ok() {
                let base64_str = general_purpose::STANDARD.encode(buffer.get_ref());

                let step = Step {
                    type_: data.step_type,
                    x: data.x,
                    y: data.y,
                    text: data.text,
                    timestamp: data.timestamp,
                    screenshot: Some(base64_str),
                };

                let _ = app_clone.emit("new-step", step);
            }
        }
    });

    // Thread 2: Capture Logic (State machine + Fast Capture)
    let is_recording_capture = is_recording.clone();
    thread::spawn(move || {
        let mut key_buffer = String::new();
        let mut last_key_time: Option<Instant> = None;
        let mut last_click_time: Option<Instant> = None;
        let mut last_click_pos: (f64, f64) = (0.0, 0.0);

        // Cache monitor reference for performance
        let monitor = Monitor::all().ok().and_then(|m| m.into_iter().next());

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
                    if let Some(ref mon) = monitor {
                        if let Ok(image) = mon.capture_image() {
                            let _ = tx_encode.send(CaptureData {
                                x: None,
                                y: None,
                                image: image::DynamicImage::ImageRgba8(image),
                                timestamp: SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                                step_type: "type".to_string(),
                                text: Some(key_buffer.clone()),
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
                        if let Some(ref mon) = monitor {
                            if let Ok(image) = mon.capture_image() {
                                let _ = tx_encode.send(CaptureData {
                                    x: None,
                                    y: None,
                                    image: image::DynamicImage::ImageRgba8(image),
                                    timestamp: SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                                    step_type: "type".to_string(),
                                    text: Some(key_buffer.clone()),
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

                    // Capture Screenshot IMMEDIATELY
                    if let Some(ref mon) = monitor {
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
                                });
                                key_buffer.clear();
                                last_key_time = None;
                            }

                            // 2. Emit Click Step
                            let _ = tx_encode.send(CaptureData {
                                x: Some(x),
                                y: Some(y),
                                image: image::DynamicImage::ImageRgba8(image), // Move for click step
                                timestamp,
                                step_type: "click".to_string(),
                                text: None,
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
