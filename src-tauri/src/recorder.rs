use crate::accessibility::{get_element_at_point, get_focused_field_value, ElementInfo};
use crate::ocr::{get_models_dir, OcrConfig, OcrJob, OcrManager};
use crate::{emit_startup_status, StartupState, StartupStatus};
use image::codecs::gif::{GifEncoder, Repeat};
use image::codecs::jpeg::JpegEncoder;
use image::{Delay, Frame, Rgb};
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

/// Check if the given app name indicates this is the StepSnap application
fn is_stepsnap_app(app_name: &Option<String>) -> bool {
    if let Some(name) = app_name {
        let name_lower = name.to_lowercase();
        name_lower.contains("stepsnap")
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
    /// Where the `text` field came from for type steps: "keystrokes" (raw
    /// rdev event stream), "ax_value" / "ax_text" / "ax_legacy" (read from
    /// the focused element via the accessibility API), or "password" (the
    /// field was secure; content was redacted before reaching this point).
    /// `None` for click / capture steps.
    input_source: Option<String>,
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
    /// Whether to capture an after-frame ~700ms-2s after each event.
    /// When false the encoder thread skips spawning the after-frame worker
    /// entirely (no extra screen capture, no extra disk write).
    pub state_diff_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
    /// Cap on how long the settling loop will wait for the UI to stabilise
    /// before snapshotting the after-frame. Default 2000ms.
    pub after_frame_max_wait_ms: std::sync::Arc<std::sync::Mutex<u64>>,
    /// Whether to maintain a continuous frame buffer and emit a short clip
    /// per event (8a). Off by default — opt-in due to memory cost.
    pub video_clips_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
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
            state_diff_enabled: std::sync::Arc::new(std::sync::Mutex::new(true)),
            after_frame_max_wait_ms: std::sync::Arc::new(std::sync::Mutex::new(2000)),
            video_clips_enabled: std::sync::Arc::new(std::sync::Mutex::new(false)),
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
    /// Origin of `text` for type steps. See `Step::input_source`.
    input_source: Option<String>,
    /// Absolute screen coordinates of an anchor inside the captured monitor.
    /// Used by the after-frame thread to identify the same monitor 700ms
    /// later via `Monitor::from_point`. For clicks this is the click position;
    /// for type steps it's the foreground window's centre.
    anchor: Option<(f64, f64)>,
}

/// Decide what `text` to record for a type-step flush. Prefers the focused
/// field's AX value over the raw keystroke buffer — that handles autocomplete,
/// paste, IME, and edit-then-retype patterns the keystroke stream gets wrong.
/// Returns `None` if the field is a password (caller should drop the step).
fn resolve_type_step_text(key_buffer_text: &str) -> Option<(String, &'static str)> {
    match get_focused_field_value() {
        Some(ffv) if ffv.is_password => None,
        Some(ffv) if !ffv.value.is_empty() => Some((ffv.value, ffv.source)),
        _ => Some((key_buffer_text.to_string(), "keystrokes")),
    }
}

/// Data sent to OCR processing thread
struct OcrData {
    step_id: String,
    image: Arc<image::DynamicImage>,
    x: Option<i32>,
    y: Option<i32>,
    step_type: String,
}

/// Centre of a monitor in absolute screen coordinates. Used as an anchor
/// point so the after-frame thread can re-find the same monitor later.
fn monitor_center(mon: &Monitor) -> Option<(f64, f64)> {
    let x = mon.x().ok()? as f64;
    let y = mon.y().ok()? as f64;
    let w = mon.width().ok()? as f64;
    let h = mon.height().ok()? as f64;
    Some((x + w / 2.0, y + h / 2.0))
}

/// Mean absolute luminance delta between two frames, downsampled to a small
/// tile so the comparison is fast (~50us per call on a modern CPU). Returns
/// a value in [0, 1] where 0 = identical, 1 = maximum possible delta.
///
/// Uses ITU-R BT.601 weights and a 120x80 tile — large enough to catch
/// meaningful UI changes (panel opens, menu appears, page navigates) but
/// insensitive to single-pixel anti-aliasing flicker or a blinking caret.
fn frame_mean_delta(a: &image::RgbaImage, b: &image::RgbaImage) -> f32 {
    const W: u32 = 120;
    const H: u32 = 80;
    let sa = image::imageops::resize(a, W, H, image::imageops::FilterType::Nearest);
    let sb = image::imageops::resize(b, W, H, image::imageops::FilterType::Nearest);
    let mut total: u32 = 0;
    for (pa, pb) in sa.pixels().zip(sb.pixels()) {
        // BT.601 luminance approximation.
        let la = (0.299 * pa[0] as f32 + 0.587 * pa[1] as f32 + 0.114 * pa[2] as f32) as i32;
        let lb = (0.299 * pb[0] as f32 + 0.587 * pb[1] as f32 + 0.114 * pb[2] as f32) as i32;
        total += (la - lb).unsigned_abs();
    }
    let max_total = (W * H * 255) as f32;
    total as f32 / max_total
}

/// Capture a short animated GIF "clip" by sampling the same monitor at fixed
/// intervals after the event. Used by the optional video-clip pipeline (8a).
///
/// We deliberately sample after the event rather than maintaining a
/// continuous frame buffer: it's much lighter on memory (no constant capture
/// loop) and the click marker that's already on the primary screenshot
/// substitutes for a "before" frame.
///
/// Frames are downsampled to half-resolution before GIF encoding so file
/// sizes stay reasonable. Five frames at 400ms intervals = 2 seconds of
/// playable timeline.
fn capture_clip_gif(
    anchor_x: f64,
    anchor_y: f64,
    out_path: &std::path::Path,
    frame_count: u32,
    interval_ms: u64,
) -> bool {
    let mon = match get_monitor_at_point(anchor_x, anchor_y) {
        Some(m) => m,
        None => return false,
    };

    let mut frames: Vec<image::RgbaImage> = Vec::with_capacity(frame_count as usize);
    for _ in 0..frame_count {
        thread::sleep(Duration::from_millis(interval_ms));
        if let Ok(img) = mon.capture_image() {
            // Downsample to half resolution before storing — GIF palette
            // encoding gets exponentially larger with dimensions.
            let (w, h) = (img.width() / 2, img.height() / 2);
            if w > 0 && h > 0 {
                let small = image::imageops::resize(
                    &img,
                    w,
                    h,
                    image::imageops::FilterType::Triangle,
                );
                frames.push(small);
            }
        }
    }

    if frames.is_empty() {
        return false;
    }

    let file = match fs::File::create(out_path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let writer = BufWriter::new(file);
    let mut encoder = GifEncoder::new(writer);
    if encoder.set_repeat(Repeat::Infinite).is_err() {
        return false;
    }
    for img in frames {
        // Delay::from_numer_denom_ms expresses the per-frame delay as a fraction.
        let delay = Delay::from_numer_denom_ms(interval_ms as u32, 1);
        let frame = Frame::from_parts(img, 0, 0, delay);
        if encoder.encode_frame(frame).is_err() {
            return false;
        }
    }
    true
}

/// Adaptive after-frame capture. Sleeps an initial period, then polls until
/// two consecutive frames are sufficiently similar (UI has settled) or the
/// `max_wait_ms` cap is reached. Returns the most recent captured frame.
fn capture_settled_frame(
    anchor_x: f64,
    anchor_y: f64,
    initial_wait_ms: u64,
    max_wait_ms: u64,
    poll_interval_ms: u64,
    settling_threshold: f32,
) -> Option<image::RgbaImage> {
    thread::sleep(Duration::from_millis(initial_wait_ms));

    let mon = get_monitor_at_point(anchor_x, anchor_y)?;
    let mut prev = mon.capture_image().ok()?;
    let mut total_waited = initial_wait_ms;

    loop {
        if total_waited >= max_wait_ms {
            return Some(prev);
        }
        thread::sleep(Duration::from_millis(poll_interval_ms));
        total_waited += poll_interval_ms;

        let next = match mon.capture_image() {
            Ok(img) => img,
            // Capture failure on a later poll — return what we have rather than fail outright.
            Err(_) => return Some(prev),
        };

        if frame_mean_delta(&prev, &next) < settling_threshold {
            return Some(next);
        }

        prev = next;
    }
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
    use crate::display::{detect_display_server, DisplayServer};
    use std::process::Command;

    match detect_display_server() {
        DisplayServer::X11 => {
            // X11: Use xdotool to get active window geometry
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

                        if let Some(monitor) =
                            get_monitor_at_point(center_x as f64, center_y as f64)
                        {
                            return Some(monitor);
                        }
                    }
                }
            }

            // Fallback: Try using wmctrl
            if let Ok(output) = Command::new("wmctrl").args(["-l", "-G"]).output() {
                if output.status.success() {
                    // wmctrl output is less reliable, fall through to default
                }
            }
        }
        DisplayServer::Wayland => {
            // Wayland: No standardized API for getting active window info.
            // xdotool doesn't work on Wayland. We fall back to primary monitor.
            // This is a known limitation - typing events will use primary monitor.
        }
        DisplayServer::Unknown => {
            // Unknown: Can't determine display server, fall back to default
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
    use crate::display::{detect_display_server, DisplayServer};
    use std::process::Command;

    match detect_display_server() {
        DisplayServer::X11 => {
            // X11: Use xdotool to get active window name
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
        }
        DisplayServer::Wayland => {
            // Wayland: No standardized API for getting active window info.
            // This feature is degraded on Wayland - we can't reliably detect
            // which app the user is interacting with.
            // Return None to indicate we can't detect it.
        }
        DisplayServer::Unknown => {
            // Unknown: Can't determine display server
        }
    }

    None
}

pub fn start_listener(
    app: AppHandle,
    is_recording: std::sync::Arc<std::sync::Mutex<bool>>,
    is_picker_open: std::sync::Arc<std::sync::Mutex<bool>>,
    ocr_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
    state_diff_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
    after_frame_max_wait_ms: std::sync::Arc<std::sync::Mutex<u64>>,
    video_clips_enabled: std::sync::Arc<std::sync::Mutex<bool>>,
    startup_state: StartupState,
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
    let state_diff_enabled_clone = state_diff_enabled.clone();
    let after_frame_max_wait_clone = after_frame_max_wait_ms.clone();
    let video_clips_enabled_clone = video_clips_enabled.clone();
    let startup_state_ocr = startup_state.clone();

    emit_startup_status(
        &app,
        &startup_state,
        StartupStatus::running("ocr", "OCR warmup queued"),
    );

    // Note: Capture hotkey is now handled by the frontend (monitor picker UI)
    // The old capture event listener has been removed

    // Thread 4: OCR Processor (processes screenshots asynchronously)
    thread::spawn(move || {
        // Get models directory and initialize OCR engine
        emit_startup_status(
            &app_clone_ocr,
            &startup_state_ocr,
            StartupStatus::running("ocr", "Loading OCR models"),
        );
        let models_dir = get_models_dir(&app_clone_ocr);
        let ocr_manager = match OcrManager::new(models_dir.clone(), OcrConfig::default()) {
            Ok(m) => {
                println!("OCR engine initialized successfully from {:?}", models_dir);
                emit_startup_status(
                    &app_clone_ocr,
                    &startup_state_ocr,
                    StartupStatus::success("ocr", "OCR ready"),
                );
                m
            }
            Err(e) => {
                eprintln!(
                    "Failed to initialize OCR engine: {}. OCR will be disabled.",
                    e
                );
                emit_startup_status(
                    &app_clone_ocr,
                    &startup_state_ocr,
                    StartupStatus::failed("ocr", "OCR unavailable"),
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
        let temp_dir = std::env::temp_dir().join("stepsnap_screenshots");
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
                id: step_id.clone(),
                type_: data.step_type.clone(),
                x: data.x,
                y: data.y,
                text: data.text,
                timestamp: data.timestamp,
                screenshot: screenshot_path,
                element_name: data.element_info.as_ref().map(|e| e.name.clone()),
                element_type: data.element_info.as_ref().map(|e| e.element_type.clone()),
                element_value: data.element_info.as_ref().and_then(|e| e.value.clone()),
                app_name: data.element_info.as_ref().and_then(|e| e.app_name.clone()),
                input_source: data.input_source,
            };

            let _ = app_clone.emit("new-step", step);

            // Schedule a one-shot after-frame capture, so the AI prompt can see
            // what changed on screen after the action. Skipped for `capture`
            // (manual verification) steps and when the user has disabled
            // state-diff in settings.
            let state_diff_on = *state_diff_enabled_clone.lock().unwrap();
            if state_diff_on && data.step_type != "capture" {
                if let Some((anchor_x, anchor_y)) = data.anchor {
                    let app_after = app_clone.clone();
                    let temp_dir_after = temp_dir.clone();
                    let after_step_id = step_id.clone();
                    let max_wait_ms = *after_frame_max_wait_clone.lock().unwrap();
                    thread::spawn(move || {
                        // Adaptive settling capture — see capture_settled_frame.
                        // The cap (set via the afterFrameMaxWaitMs setting)
                        // bounds the worst case so a continuously-animating
                        // app (carousel, video) can't stall this thread.
                        let image = match capture_settled_frame(
                            anchor_x,
                            anchor_y,
                            300,                 // initial wait before first capture
                            max_wait_ms.max(500), // cap
                            200,                 // poll interval
                            0.008,               // mean-luminance-delta threshold
                        ) {
                            Some(img) => img,
                            None => return,
                        };

                        let rgb_image = image::DynamicImage::ImageRgba8(image).to_rgb8();
                        let after_counter = SCREENSHOT_COUNTER.fetch_add(1, Ordering::SeqCst);
                        let after_filename = format!(
                            "screenshot_{}_{}_after.jpg",
                            SystemTime::now()
                                .duration_since(SystemTime::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis(),
                            after_counter,
                        );
                        let after_path = temp_dir_after.join(&after_filename);
                        let after_file = match fs::File::create(&after_path) {
                            Ok(f) => f,
                            Err(_) => return,
                        };
                        let mut after_writer = BufWriter::new(after_file);
                        let mut after_encoder =
                            JpegEncoder::new_with_quality(&mut after_writer, 85);
                        if after_encoder.encode_image(&rgb_image).is_err() {
                            return;
                        }
                        // Important: flush+close the writer before emitting so
                        // the frontend can read the file immediately.
                        drop(after_encoder);
                        if after_writer.into_inner().is_err() {
                            return;
                        }

                        let _ = app_after.emit(
                            "new-step-after",
                            serde_json::json!({
                                "step_id": after_step_id,
                                "after_screenshot_path": after_path.to_string_lossy(),
                            }),
                        );
                    });
                }
            }

            // Video clips (8a) — capture a short animated GIF showing the
            // 2 seconds after the event. Gated on user setting. Independent
            // thread so it doesn't block the after-frame or next event.
            let video_on = *video_clips_enabled_clone.lock().unwrap();
            if video_on && data.step_type != "capture" {
                if let Some((anchor_x, anchor_y)) = data.anchor {
                    let app_clip = app_clone.clone();
                    let temp_dir_clip = temp_dir.clone();
                    let clip_step_id = step_id.clone();
                    thread::spawn(move || {
                        let clip_filename = format!("{}_clip.gif", clip_step_id);
                        let clip_path = temp_dir_clip.join(&clip_filename);
                        if !capture_clip_gif(
                            anchor_x,
                            anchor_y,
                            &clip_path,
                            5,    // frame count
                            400,  // interval between frames in ms (total ~2s)
                        ) {
                            return;
                        }
                        let _ = app_clip.emit(
                            "new-step-clip",
                            serde_json::json!({
                                "step_id": clip_step_id,
                                "clip_path": clip_path.to_string_lossy(),
                            }),
                        );
                    });
                }
            }
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
                    // Check if typing is happening in StepSnap - if so, discard the buffer
                    let fg_app = get_foreground_window_app_name();
                    if is_stepsnap_app(&fg_app) {
                        key_buffer.clear();
                        last_key_time = None;
                        continue; // Discard - was typing in StepSnap
                    }

                    // Read the focused field's actual value via AX (handles
                    // autocomplete, paste, IME). None = password field → skip
                    // the step entirely.
                    let key_buf_trim = key_buffer.trim().to_string();
                    match resolve_type_step_text(&key_buf_trim) {
                        None => {
                            key_buffer.clear();
                            last_key_time = None;
                        }
                        Some((final_text, source)) => {
                            if let Some(mon) = get_monitor_for_foreground_window() {
                                if let Ok(image) = mon.capture_image() {
                                    let anchor = monitor_center(&mon);
                                    let _ = tx_encode.send(CaptureData {
                                        x: None,
                                        y: None,
                                        image: Arc::new(image::DynamicImage::ImageRgba8(image)),
                                        timestamp: SystemTime::now()
                                            .duration_since(SystemTime::UNIX_EPOCH)
                                            .unwrap_or_default()
                                            .as_millis() as u64,
                                        step_type: "type".to_string(),
                                        text: Some(final_text),
                                        element_info: None,
                                        input_source: Some(source.to_string()),
                                        anchor,
                                    });
                                    key_buffer.clear();
                                    last_key_time = None;
                                }
                            }
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
                        // Check if typing is happening in StepSnap - if so, discard the buffer
                        let fg_app = get_foreground_window_app_name();
                        if is_stepsnap_app(&fg_app) {
                            key_buffer.clear();
                            last_key_time = None;
                            continue; // Discard - was typing in StepSnap
                        }

                        let key_buf_trim = key_buffer.trim().to_string();
                        match resolve_type_step_text(&key_buf_trim) {
                            None => {
                                key_buffer.clear();
                                last_key_time = None;
                            }
                            Some((final_text, source)) => {
                                if let Some(mon) = get_monitor_for_foreground_window() {
                                    if let Ok(image) = mon.capture_image() {
                                        let anchor = monitor_center(&mon);
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
                                            text: Some(final_text),
                                            element_info: None,
                                            input_source: Some(source.to_string()),
                                            anchor,
                                        });
                                        key_buffer.clear();
                                        last_key_time = None;
                                    }
                                }
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

                    // Skip clicks within StepSnap windows (but flush pending text first)
                    if is_stepsnap_app(&element_info.as_ref().and_then(|e| e.app_name.clone())) {
                        // Still flush any pending text buffer - it was typed in another app
                        if !key_buffer.trim().is_empty() {
                            let key_buf_trim = key_buffer.trim().to_string();
                            match resolve_type_step_text(&key_buf_trim) {
                                None => {
                                    key_buffer.clear();
                                    last_key_time = None;
                                }
                                Some((final_text, source)) => {
                                    if let Some(mon) = get_monitor_for_foreground_window() {
                                        if let Ok(image) = mon.capture_image() {
                                            let anchor = monitor_center(&mon);
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
                                                text: Some(final_text),
                                                element_info: None,
                                                input_source: Some(source.to_string()),
                                                anchor,
                                            });
                                            key_buffer.clear();
                                            last_key_time = None;
                                        }
                                    }
                                }
                            }
                        }
                        continue; // Skip the click itself - it's within StepSnap
                    }

                    // Capture Screenshot from the correct monitor
                    if let Some(mon) = get_monitor_at_point(x, y) {
                        if let Ok(image) = mon.capture_image() {
                            let timestamp = SystemTime::now()
                                .duration_since(SystemTime::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_millis() as u64;

                            // 1. Flush text if any (using the same screenshot)
                            let click_anchor = monitor_center(&mon);
                            if !key_buffer.trim().is_empty() {
                                let key_buf_trim = key_buffer.trim().to_string();
                                match resolve_type_step_text(&key_buf_trim) {
                                    None => {
                                        // Password field — drop the type step entirely.
                                        key_buffer.clear();
                                        last_key_time = None;
                                    }
                                    Some((final_text, source)) => {
                                        let _ = tx_encode.send(CaptureData {
                                            x: None,
                                            y: None,
                                            image: Arc::new(image::DynamicImage::ImageRgba8(
                                                image.clone(),
                                            )),
                                            timestamp,
                                            step_type: "type".to_string(),
                                            text: Some(final_text),
                                            element_info: None,
                                            input_source: Some(source.to_string()),
                                            anchor: click_anchor,
                                        });
                                        key_buffer.clear();
                                        last_key_time = None;
                                    }
                                }
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
                                input_source: None,
                                // Use the click position itself as the anchor — it's
                                // guaranteed to be on the right monitor.
                                anchor: Some((x, y)),
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
