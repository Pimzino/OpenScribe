use crate::accessibility::{get_element_at_point, ElementInfo};
use crate::ocr::{get_models_dir, OcrConfig, OcrJob, OcrManager};
use image::codecs::jpeg::JpegEncoder;
use image::Rgb;
use imageproc::drawing::{draw_filled_circle_mut, draw_hollow_circle_mut};
use rdev::{listen, Button, EventType};
use std::fs;
use std::io::BufWriter;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use xcap::Monitor;

/// Check if the given app name indicates this is the OpenScribe application
fn is_openscribe_app(app_name: &Option<String>) -> bool {
    if let Some(name) = app_name {
        let name_lower = name.to_lowercase();
        name_lower.contains("openscribe")
    } else {
        false
    }
}

static SCREENSHOT_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, serde::Serialize)]
struct Step {
    id: String, // Unique ID for tracking OCR results
    type_: String,
    x: Option<i32>,
    y: Option<i32>,
    text: Option<String>,
    timestamp: u64,
    screenshot: Option<String>, // File path to screenshot
    element_name: Option<String>,
    element_type: Option<String>,
    element_value: Option<String>,
    app_name: Option<String>,
}

#[derive(Clone, serde::Deserialize)]
pub struct HotkeyBinding {
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
    pub key: String,
}

pub struct RecordingState {
    pub is_recording: std::sync::Arc<std::sync::Mutex<bool>>,
    pub is_picker_open: std::sync::Arc<std::sync::Mutex<bool>>,
    pub ocr_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
    pub start_hotkey: std::sync::Arc<std::sync::Mutex<HotkeyBinding>>,
    pub stop_hotkey: std::sync::Arc<std::sync::Mutex<HotkeyBinding>>,
    pub capture_hotkey: std::sync::Arc<std::sync::Mutex<HotkeyBinding>>,
}

impl RecordingState {
    pub fn new() -> Self {
        Self {
            is_recording: std::sync::Arc::new(std::sync::Mutex::new(false)),
            is_picker_open: std::sync::Arc::new(std::sync::Mutex::new(false)),
            ocr_enabled: std::sync::Arc::new(std::sync::Mutex::new(true)), // Enabled by default
            start_hotkey: std::sync::Arc::new(std::sync::Mutex::new(HotkeyBinding {
                ctrl: true,
                shift: false,
                alt: true,
                key: "KeyR".to_string(),
            })),
            stop_hotkey: std::sync::Arc::new(std::sync::Mutex::new(HotkeyBinding {
                ctrl: true,
                shift: false,
                alt: true,
                key: "KeyS".to_string(),
            })),
            capture_hotkey: std::sync::Arc::new(std::sync::Mutex::new(HotkeyBinding {
                ctrl: true,
                shift: false,
                alt: true,
                key: "KeyC".to_string(),
            })),
        }
    }
}

enum RecorderEvent {
    Click {
        x: f64,
        y: f64,
    },
    Key {
        key: rdev::Key,
        text: Option<String>,
    },
    // Note: Manual captures are now handled via the monitor picker UI
}

struct CaptureData {
    x: Option<i32>,
    y: Option<i32>,
    image: Arc<image::DynamicImage>,
    timestamp: u64,
    step_type: String,
    text: Option<String>,
    element_info: Option<ElementInfo>,
}

/// Data sent to OCR processing thread
struct OcrData {
    step_id: String,
    image: Arc<image::DynamicImage>,
    x: Option<i32>,
    y: Option<i32>,
    step_type: String,
}

// Find the monitor that contains the given point
fn get_monitor_at_point(x: f64, y: f64) -> Option<Monitor> {
    // Primary: Use xcap's built-in method (handles DPI correctly on all platforms)
    if let Ok(monitor) = Monitor::from_point(x as i32, y as i32) {
        return Some(monitor);
    }

    // Fallback: Manual iteration (in case primary fails)
    Monitor::all().ok()?.into_iter().find(|m| {
        let mx = m.x().unwrap_or(0) as f64;
        let my = m.y().unwrap_or(0) as f64;
        let mw = m.width().unwrap_or(0) as f64;
        let mh = m.height().unwrap_or(0) as f64;
        x >= mx && x < mx + mw && y >= my && y < my + mh
    })
}

// Get the monitor containing the currently focused/foreground window
// This is more reliable than tracking mouse position for typing events
#[cfg(target_os = "windows")]
fn get_monitor_for_foreground_window() -> Option<Monitor> {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect};

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return None;
        }

        // Calculate center point of the window
        let center_x = (rect.left + rect.right) / 2;
        let center_y = (rect.top + rect.bottom) / 2;

        get_monitor_at_point(center_x as f64, center_y as f64)
    }
}

#[cfg(target_os = "macos")]
fn get_monitor_for_foreground_window() -> Option<Monitor> {
    use std::process::Command;

    // Use AppleScript to get the frontmost application's window bounds
    // This is more reliable than using Core Graphics directly
    let script = r#"
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set frontWindow to first window of frontApp
            set {x, y} to position of frontWindow
            set {w, h} to size of frontWindow
            return (x as text) & "," & (y as text) & "," & (w as text) & "," & (h as text)
        end tell
    "#;

    if let Ok(output) = Command::new("osascript").args(["-e", script]).output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parts: Vec<&str> = stdout.split(',').collect();

            if parts.len() == 4 {
                if let (Ok(x), Ok(y), Ok(w), Ok(h)) = (
                    parts[0].parse::<f64>(),
                    parts[1].parse::<f64>(),
                    parts[2].parse::<f64>(),
                    parts[3].parse::<f64>(),
                ) {
                    let center_x = x + w / 2.0;
                    let center_y = y + h / 2.0;

                    if let Some(monitor) = get_monitor_at_point(center_x, center_y) {
                        return Some(monitor);
                    }
                }
            }
        }
    }

    // Fallback to primary monitor
    Monitor::all().ok()?.into_iter().next()
}

#[cfg(target_os = "linux")]
fn get_monitor_for_foreground_window() -> Option<Monitor> {
    // Linux: Try to get active window via D-Bus/AT-SPI or environment
    // This is complex due to X11/Wayland differences

    // Try reading _NET_ACTIVE_WINDOW via xdotool-like approach
    // For now, use a simpler approach: check DISPLAY env and try xdotool if available
    use std::process::Command;

    // Try using xdotool to get active window geometry (works on X11)
    if let Ok(output) = Command::new("xdotool")
        .args(["getactivewindow", "getwindowgeometry", "--shell"])
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let mut x: Option<i32> = None;
            let mut y: Option<i32> = None;
            let mut width: Option<i32> = None;
            let mut height: Option<i32> = None;

            for line in stdout.lines() {
                if let Some(val) = line.strip_prefix("X=") {
                    x = val.parse().ok();
                } else if let Some(val) = line.strip_prefix("Y=") {
                    y = val.parse().ok();
                } else if let Some(val) = line.strip_prefix("WIDTH=") {
                    width = val.parse().ok();
                } else if let Some(val) = line.strip_prefix("HEIGHT=") {
                    height = val.parse().ok();
                }
            }

            if let (Some(x), Some(y), Some(w), Some(h)) = (x, y, width, height) {
                let center_x = x + w / 2;
                let center_y = y + h / 2;

                if let Some(monitor) = get_monitor_at_point(center_x as f64, center_y as f64) {
                    return Some(monitor);
                }
            }
        }
    }

    // Fallback: Try using wmctrl
    if let Ok(output) = Command::new("wmctrl").args(["-l", "-G"]).output() {
        if output.status.success() {
            // wmctrl output format: window_id desktop x y width height hostname window_name
            // The active window typically has certain properties, but this is less reliable
            // For now, just fall back to primary monitor
        }
    }

    // Fallback to primary monitor
    Monitor::all().ok()?.into_iter().next()
}

// Get the app name/title of the foreground window (for filtering self-interactions)
#[cfg(target_os = "windows")]
fn get_foreground_window_app_name() -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
    };

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        // Get window title length
        let len = GetWindowTextLengthW(hwnd);
        if len == 0 {
            return None;
        }

        // Get window title
        let mut buffer = vec![0u16; (len + 1) as usize];
        let result = GetWindowTextW(hwnd, &mut buffer);
        if result == 0 {
            return None;
        }

        let title = String::from_utf16_lossy(&buffer[..result as usize]);
        Some(title)
    }
}

#[cfg(target_os = "macos")]
fn get_foreground_window_app_name() -> Option<String> {
    use std::process::Command;

    let script = r#"
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            return name of frontApp
        end tell
    "#;

    if let Ok(output) = Command::new("osascript").args(["-e", script]).output() {
        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn get_foreground_window_app_name() -> Option<String> {
    use std::process::Command;

    // Try using xdotool to get active window name
    if let Ok(output) = Command::new("xdotool")
        .args(["getactivewindow", "getwindowname"])
        .output()
    {
        if output.status.success() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !name.is_empty() {
                return Some(name);
            }
        }
    }
    None
}

pub fn start_listener(
    app: AppHandle,
    is_recording: std::sync::Arc<std::sync::Mutex<bool>>,
    is_picker_open: std::sync::Arc<std::sync::Mutex<bool>>,
    ocr_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
) {
    // Channel 1: Listener -> Capture Logic
    let (tx_event, rx_event) = mpsc::channel::<RecorderEvent>();

    // Channel 2: Capture Logic -> Encoder
    let (tx_encode, rx_encode) = mpsc::channel::<CaptureData>();

    // Channel 3: Encoder -> OCR Processor
    let (tx_ocr, rx_ocr) = mpsc::channel::<OcrData>();

    let app_clone = app.clone();
    let app_clone_ocr = app.clone();
    let ocr_enabled_clone = ocr_enabled.clone();

    // Note: Capture hotkey is now handled by the frontend (monitor picker UI)
    // The old capture event listener has been removed

    // Thread 4: OCR Processor (processes screenshots asynchronously)
    thread::spawn(move || {
        // Get models directory and initialize OCR engine
        let models_dir = get_models_dir(&app_clone_ocr);
        let ocr_manager = match OcrManager::new(models_dir.clone(), OcrConfig::default()) {
            Ok(m) => {
                println!("OCR engine initialized successfully from {:?}", models_dir);
                m
            }
            Err(e) => {
                eprintln!(
                    "Failed to initialize OCR engine: {}. OCR will be disabled.",
                    e
                );
                OcrManager::disabled()
            }
        };

        for ocr_data in rx_ocr {
            // Check if OCR is enabled
            if !*ocr_enabled_clone.lock().unwrap() || !ocr_manager.is_enabled() {
                continue;
            }

            let job = OcrJob {
                step_id: ocr_data.step_id.clone(),
                image: ocr_data.image,
                x: ocr_data.x,
                y: ocr_data.y,
                step_type: ocr_data.step_type,
            };

            let result = ocr_manager.process_job(&job);

            // Emit OCR result to frontend
            let _ = app_clone_ocr.emit("ocr-result", &result);
        }
    });

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
                    let cx = x;
                    let cy = y;

                    // Colors for highlight
                    let outer_color = Rgb([255u8, 69u8, 0u8]); // Orange-red
                    let inner_color = Rgb([255u8, 0u8, 0u8]); // Red

                    // Draw outer ring (multiple circles for thickness)
                    for r in 30..=35 {
                        draw_hollow_circle_mut(&mut rgb_image, (cx, cy), r, outer_color);
                    }

                    // Draw inner filled dot
                    draw_filled_circle_mut(&mut rgb_image, (cx, cy), 5, inner_color);
                }
            }

            // Generate unique step ID for tracking OCR results
            let step_id = Uuid::new_v4().to_string();

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

            // Send to OCR thread for async processing (non-blocking)
            let _ = tx_ocr.send(OcrData {
                step_id: step_id.clone(),
                image: data.image.clone(),
                x: data.x,
                y: data.y,
                step_type: data.step_type.clone(),
            });

            let step = Step {
                id: step_id,
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
    let is_picker_open_capture = is_picker_open.clone();
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
            let picker_open = *is_picker_open_capture.lock().unwrap();
            if !recording || picker_open {
                key_buffer.clear();
                last_key_time = None;
                continue; // Skip all events when not recording or when picker is open
            }

            // Check if we need to flush text buffer due to timeout
            if let Some(last_time) = last_key_time {
                if last_time.elapsed() >= text_flush_timeout && !key_buffer.trim().is_empty() {
                    // Check if typing is happening in OpenScribe - if so, discard the buffer
                    let fg_app = get_foreground_window_app_name();
                    if is_openscribe_app(&fg_app) {
                        key_buffer.clear();
                        last_key_time = None;
                        continue; // Discard - was typing in OpenScribe
                    }

                    // Get monitor containing the foreground window (where user is typing)
                    if let Some(mon) = get_monitor_for_foreground_window() {
                        if let Ok(image) = mon.capture_image() {
                            let _ = tx_encode.send(CaptureData {
                                x: None,
                                y: None,
                                image: Arc::new(image::DynamicImage::ImageRgba8(image)),
                                timestamp: SystemTime::now()
                                    .duration_since(SystemTime::UNIX_EPOCH)
                                    .unwrap_or_default()
                                    .as_millis() as u64,
                                step_type: "type".to_string(),
                                text: Some(key_buffer.trim().to_string()),
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
                    let is_backspace = key == rdev::Key::Backspace;
                    let is_delete = key == rdev::Key::Delete;
                    let is_space = key == rdev::Key::Space;

                    // Handle backspace - remove last character
                    if is_backspace && !key_buffer.is_empty() {
                        key_buffer.pop();
                        last_key_time = Some(Instant::now());
                    }
                    // Handle delete key similarly
                    else if is_delete && !key_buffer.is_empty() {
                        key_buffer.pop();
                        last_key_time = Some(Instant::now());
                    }
                    // Handle space explicitly (event.name may not be reliable)
                    else if is_space {
                        key_buffer.push(' ');
                        last_key_time = Some(Instant::now());
                    } else if let Some(t) = text {
                        // Filter out control characters from text representation if needed
                        if t.len() == 1 {
                            key_buffer.push_str(&t);
                            last_key_time = Some(Instant::now());
                        }
                    }

                    // Flush on Return or Tab - only if buffer has actual content (not just whitespace)
                    if (is_return || is_tab) && !key_buffer.trim().is_empty() {
                        // Check if typing is happening in OpenScribe - if so, discard the buffer
                        let fg_app = get_foreground_window_app_name();
                        if is_openscribe_app(&fg_app) {
                            key_buffer.clear();
                            last_key_time = None;
                            continue; // Discard - was typing in OpenScribe
                        }

                        // Get monitor containing the foreground window (where user is typing)
                        if let Some(mon) = get_monitor_for_foreground_window() {
                            if let Ok(image) = mon.capture_image() {
                                let _ = tx_encode.send(CaptureData {
                                    x: None,
                                    y: None,
                                    image: Arc::new(image::DynamicImage::ImageRgba8(image)),
                                    timestamp: SystemTime::now()
                                        .duration_since(SystemTime::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64,
                                    step_type: "type".to_string(),
                                    text: Some(key_buffer.trim().to_string()),
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
                        let distance = ((x - last_click_pos.0).powi(2)
                            + (y - last_click_pos.1).powi(2))
                        .sqrt();

                        if time_diff < click_debounce && distance < click_distance_threshold {
                            continue; // Skip this click (debounced)
                        }
                    }
                    last_click_time = Some(now);
                    last_click_pos = (x, y);

                    // Get element info at click point using accessibility APIs
                    let element_info = get_element_at_point(x, y);

                    // Skip clicks within OpenScribe windows (but flush pending text first)
                    if is_openscribe_app(&element_info.as_ref().and_then(|e| e.app_name.clone())) {
                        // Still flush any pending text buffer - it was typed in another app
                        if !key_buffer.trim().is_empty() {
                            if let Some(mon) = get_monitor_for_foreground_window() {
                                if let Ok(image) = mon.capture_image() {
                                    let timestamp = SystemTime::now()
                                        .duration_since(SystemTime::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_millis()
                                        as u64;
                                    let _ = tx_encode.send(CaptureData {
                                        x: None,
                                        y: None,
                                        image: Arc::new(image::DynamicImage::ImageRgba8(image)),
                                        timestamp,
                                        step_type: "type".to_string(),
                                        text: Some(key_buffer.trim().to_string()),
                                        element_info: None,
                                    });
                                    key_buffer.clear();
                                    last_key_time = None;
                                }
                            }
                        }
                        continue; // Skip the click itself - it's within OpenScribe
                    }

                    // Capture Screenshot from the correct monitor
                    if let Some(mon) = get_monitor_at_point(x, y) {
                        if let Ok(image) = mon.capture_image() {
                            let timestamp = SystemTime::now()
                                .duration_since(SystemTime::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            // 1. Flush text if any (using the same screenshot)
                            if !key_buffer.trim().is_empty() {
                                let _ = tx_encode.send(CaptureData {
                                    x: None,
                                    y: None,
                                    image: Arc::new(image::DynamicImage::ImageRgba8(image.clone())), // Clone for text step
                                    timestamp,
                                    step_type: "type".to_string(),
                                    text: Some(key_buffer.trim().to_string()),
                                    element_info: None,
                                });
                                key_buffer.clear();
                                last_key_time = None;
                            }

                            // 2. Emit Click Step with element info
                            // Convert absolute screen coordinates to monitor-relative coordinates
                            // This ensures the click highlight is drawn at the correct position on the captured image
                            let rel_x = (x - mon.x().unwrap_or(0) as f64).round() as i32;
                            let rel_y = (y - mon.y().unwrap_or(0) as f64).round() as i32;

                            let _ = tx_encode.send(CaptureData {
                                x: Some(rel_x),
                                y: Some(rel_y),
                                image: Arc::new(image::DynamicImage::ImageRgba8(image)), // Move for click step
                                timestamp,
                                step_type: "click".to_string(),
                                text: None,
                                element_info,
                            });
                        }
                    }
                } // Note: Manual captures (RecorderEvent::Capture) have been moved to monitor picker UI
            }
        }
    });

    // Thread 1: Input Listener (Must be non-blocking / fast)
    thread::spawn(move || {
        let mut current_x = 0.0;
        let mut current_y = 0.0;

        if let Err(error) = listen(move |event| match event.event_type {
            EventType::MouseMove { x, y } => {
                current_x = x;
                current_y = y;
            }
            EventType::ButtonPress(Button::Left) => {
                let _ = tx_event.send(RecorderEvent::Click {
                    x: current_x,
                    y: current_y,
                });
            }
            EventType::KeyPress(key) => {
                let _ = tx_event.send(RecorderEvent::Key {
                    key,
                    text: event.name,
                });
            }
            _ => {}
        }) {
            eprintln!("Input listener error: {:?}", error);
        }
    });
}
