// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod recorder;
mod accessibility;
mod database;
mod overlay;

use std::sync::Mutex;
use std::path::PathBuf;
use std::io::Write;
use tauri::{AppHandle, State, Manager, Emitter, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use recorder::{RecordingState, HotkeyBinding};
use database::{Database, StepInput, Recording, RecordingWithSteps, Statistics};

pub struct DatabaseState(pub Mutex<Database>);

#[tauri::command]
async fn close_splashscreen(window: WebviewWindow) {
    if let Some(splashscreen) = window.get_webview_window("splashscreen") {
        splashscreen.close().unwrap();
    }
    window.get_webview_window("main").unwrap().show().unwrap();
}

#[tauri::command]
fn start_recording(state: State<'_, RecordingState>, _app: AppHandle) {
    let mut is_recording = state.is_recording.lock().unwrap();
    if !*is_recording {
        *is_recording = true;
    }
}

#[tauri::command]
fn stop_recording(state: State<'_, RecordingState>) {
    let mut is_recording = state.is_recording.lock().unwrap();
    *is_recording = false;
}

#[tauri::command]
fn delete_screenshot(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

// Convert HotkeyBinding to Shortcut
fn binding_to_shortcut(binding: &HotkeyBinding) -> Option<Shortcut> {
    let mut modifiers = Modifiers::empty();
    if binding.ctrl {
        modifiers |= Modifiers::CONTROL;
    }
    if binding.shift {
        modifiers |= Modifiers::SHIFT;
    }
    if binding.alt {
        modifiers |= Modifiers::ALT;
    }

    let code = match binding.key.as_str() {
        "KeyA" => Code::KeyA,
        "KeyB" => Code::KeyB,
        "KeyC" => Code::KeyC,
        "KeyD" => Code::KeyD,
        "KeyE" => Code::KeyE,
        "KeyF" => Code::KeyF,
        "KeyG" => Code::KeyG,
        "KeyH" => Code::KeyH,
        "KeyI" => Code::KeyI,
        "KeyJ" => Code::KeyJ,
        "KeyK" => Code::KeyK,
        "KeyL" => Code::KeyL,
        "KeyM" => Code::KeyM,
        "KeyN" => Code::KeyN,
        "KeyO" => Code::KeyO,
        "KeyP" => Code::KeyP,
        "KeyQ" => Code::KeyQ,
        "KeyR" => Code::KeyR,
        "KeyS" => Code::KeyS,
        "KeyT" => Code::KeyT,
        "KeyU" => Code::KeyU,
        "KeyV" => Code::KeyV,
        "KeyW" => Code::KeyW,
        "KeyX" => Code::KeyX,
        "KeyY" => Code::KeyY,
        "KeyZ" => Code::KeyZ,
        "Digit0" => Code::Digit0,
        "Digit1" => Code::Digit1,
        "Digit2" => Code::Digit2,
        "Digit3" => Code::Digit3,
        "Digit4" => Code::Digit4,
        "Digit5" => Code::Digit5,
        "Digit6" => Code::Digit6,
        "Digit7" => Code::Digit7,
        "Digit8" => Code::Digit8,
        "Digit9" => Code::Digit9,
        "F1" => Code::F1,
        "F2" => Code::F2,
        "F3" => Code::F3,
        "F4" => Code::F4,
        "F5" => Code::F5,
        "F6" => Code::F6,
        "F7" => Code::F7,
        "F8" => Code::F8,
        "F9" => Code::F9,
        "F10" => Code::F10,
        "F11" => Code::F11,
        "F12" => Code::F12,
        "Space" => Code::Space,
        "Enter" => Code::Enter,
        "Escape" => Code::Escape,
        "Backspace" => Code::Backspace,
        "Tab" => Code::Tab,
        _ => return None,
    };

    Some(Shortcut::new(Some(modifiers), code))
}

#[tauri::command]
fn set_hotkeys(app: AppHandle, state: State<'_, RecordingState>, start: HotkeyBinding, stop: HotkeyBinding, capture: Option<HotkeyBinding>) -> Result<(), String> {
    let global_shortcut = app.global_shortcut();

    // Get old shortcuts to unregister
    let old_start = state.start_hotkey.lock().unwrap().clone();
    let old_stop = state.stop_hotkey.lock().unwrap().clone();
    let old_capture = state.capture_hotkey.lock().unwrap().clone();

    // Unregister old shortcuts
    if let Some(shortcut) = binding_to_shortcut(&old_start) {
        let _ = global_shortcut.unregister(shortcut);
    }
    if let Some(shortcut) = binding_to_shortcut(&old_stop) {
        let _ = global_shortcut.unregister(shortcut);
    }
    if let Some(shortcut) = binding_to_shortcut(&old_capture) {
        let _ = global_shortcut.unregister(shortcut);
    }

    // Register new shortcuts
    if let Some(shortcut) = binding_to_shortcut(&start) {
        global_shortcut.on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = _app.emit("hotkey-start", ());
            }
        }).map_err(|e| e.to_string())?;
    }

    if let Some(shortcut) = binding_to_shortcut(&stop) {
        global_shortcut.on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = _app.emit("hotkey-stop", ());
            }
        }).map_err(|e| e.to_string())?;
    }

    // Register capture hotkey if provided
    let capture_binding = capture.unwrap_or_else(|| old_capture.clone());
    if let Some(shortcut) = binding_to_shortcut(&capture_binding) {
        global_shortcut.on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                let _ = _app.emit("hotkey-capture", ());
            }
        }).map_err(|e| e.to_string())?;
    }

    // Update state
    *state.start_hotkey.lock().unwrap() = start;
    *state.stop_hotkey.lock().unwrap() = stop;
    *state.capture_hotkey.lock().unwrap() = capture_binding;

    Ok(())
}

// Database commands
#[tauri::command]
fn create_recording(db: State<'_, DatabaseState>, name: String) -> Result<String, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .create_recording(name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_steps(db: State<'_, DatabaseState>, recording_id: String, steps: Vec<StepInput>) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .save_steps(&recording_id, steps)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_documentation(db: State<'_, DatabaseState>, recording_id: String, documentation: String) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .save_documentation(&recording_id, &documentation)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_recordings(db: State<'_, DatabaseState>) -> Result<Vec<Recording>, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .list_recordings()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recording(db: State<'_, DatabaseState>, id: String) -> Result<Option<RecordingWithSteps>, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .get_recording(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_recording(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .delete_recording(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_recording_name(db: State<'_, DatabaseState>, id: String, name: String) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .update_recording_name(&id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_statistics(db: State<'_, DatabaseState>) -> Result<Statistics, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .get_statistics()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_default_screenshot_path(db: State<'_, DatabaseState>) -> Result<String, String> {
    let path = db.0.lock()
        .map_err(|e| e.to_string())?
        .get_default_screenshot_path();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn validate_screenshot_path(path: String) -> Result<bool, String> {
    let path = PathBuf::from(&path);

    // Check if path exists and is a directory
    if !path.exists() {
        // Try to create it
        if let Err(e) = std::fs::create_dir_all(&path) {
            return Err(format!("Cannot create directory: {}", e));
        }
    } else if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    // Check if writable by creating a temp file
    let test_file = path.join(".openscribe_write_test");
    match std::fs::write(&test_file, "test") {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_file);
            Ok(true)
        }
        Err(e) => Err(format!("Directory is not writable: {}", e))
    }
}

#[tauri::command]
fn register_asset_scope(app: AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);

    if path.as_os_str().is_empty() {
        return Ok(());
    }

    // Ensure directory exists
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }

    // Add the directory and all subdirectories to the asset protocol scope
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| format!("Failed to register asset scope: {}", e))
}

#[tauri::command]
fn save_cropped_image(path: String, base64_data: String) -> Result<String, String> {
    // Decode base64 to bytes
    use base64::{Engine as _, engine::general_purpose};
    let image_data = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Write to file
    let mut file = std::fs::File::create(&path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(path)
}

#[tauri::command]
fn update_step_screenshot(db: State<'_, DatabaseState>, step_id: String, screenshot_path: String, is_cropped: bool) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .update_step_screenshot(&step_id, &screenshot_path, is_cropped)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reorder_steps(db: State<'_, DatabaseState>, recording_id: String, step_ids: Vec<String>) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .reorder_steps(&recording_id, step_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_step_description(db: State<'_, DatabaseState>, step_id: String, description: String) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .update_step_description(&step_id, &description)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_step(db: State<'_, DatabaseState>, step_id: String) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .delete_step(&step_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_steps_with_path(
    db: State<'_, DatabaseState>,
    recording_id: String,
    recording_name: String,
    steps: Vec<StepInput>,
    screenshot_path: Option<String>
) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .save_steps_with_path(&recording_id, &recording_name, steps, screenshot_path.as_deref())
        .map_err(|e| e.to_string())
}

// Monitor info structure for frontend
#[derive(Clone, serde::Serialize)]
pub struct MonitorInfo {
    pub index: usize,
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_primary: bool,
}

// Window info structure for frontend
#[derive(Clone, serde::Serialize)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app_name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub is_minimized: bool,
}

#[tauri::command]
fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for (index, mon) in monitors.iter().enumerate() {
        result.push(MonitorInfo {
            index,
            name: mon.name().unwrap_or_else(|_| format!("Monitor {}", index + 1)),
            x: mon.x().unwrap_or(0),
            y: mon.y().unwrap_or(0),
            width: mon.width().unwrap_or(0),
            height: mon.height().unwrap_or(0),
            is_primary: mon.is_primary().unwrap_or(false),
        });
    }

    Ok(result)
}

// Helper function to filter system windows
fn is_capturable_window(title: &str, _app_name: &str) -> bool {
    // Filter empty titles
    if title.trim().is_empty() {
        return false;
    }

    // Filter system windows
    let system_titles = [
        "Program Manager",
        "Windows Input Experience",
        "Microsoft Text Input Application",
        "Settings",
        "MSCTFIME UI",
        "Default IME",
    ];

    // Filter own windows
    if title.contains("OpenScribe") || title.contains("Select Capture") || title.contains("monitor-picker") {
        return false;
    }

    !system_titles.iter().any(|s| title.eq_ignore_ascii_case(s))
}

#[tauri::command]
fn get_windows() -> Result<Vec<WindowInfo>, String> {
    use xcap::Window;

    let windows = Window::all().map_err(|e| e.to_string())?;
    let mut result = Vec::new();

    for window in windows.iter() {
        let title = window.title().unwrap_or_default();
        let app_name = window.app_name().unwrap_or_default();

        if !is_capturable_window(&title, &app_name) {
            continue;
        }

        // Skip windows with zero size
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);
        if width == 0 || height == 0 {
            continue;
        }

        result.push(WindowInfo {
            id: window.id().ok().unwrap_or(0),
            title,
            app_name,
            x: window.x().unwrap_or(0),
            y: window.y().unwrap_or(0),
            width,
            height,
            is_minimized: window.is_minimized().unwrap_or(false),
        });
    }

    // Limit to prevent UI issues
    result.truncate(30);

    Ok(result)
}

#[tauri::command]
async fn show_window_highlight(window_id: u32) -> Result<(), String> {
    use xcap::Window;

    let windows = Window::all().map_err(|e| e.to_string())?;
    let target = windows.iter().find(|w| w.id().ok().unwrap_or(0) == window_id)
        .ok_or("Window not found")?;

    // Don't show highlight for minimized windows (no valid position)
    if target.is_minimized().unwrap_or(false) {
        return Ok(());
    }

    let x = target.x().unwrap_or(0);
    let y = target.y().unwrap_or(0);
    let width = target.width().unwrap_or(0);
    let height = target.height().unwrap_or(0);

    overlay::show_monitor_border(x, y, width, height)
}

// Helper to save capture and emit events
async fn save_and_emit_capture(app: AppHandle, image: image::RgbaImage, prefix: &str) -> Result<String, String> {
    use image::codecs::jpeg::JpegEncoder;
    use std::io::BufWriter;
    use tokio::time::{sleep, Duration};

    let temp_dir = std::env::temp_dir().join("openscribe_screenshots");
    let _ = std::fs::create_dir_all(&temp_dir);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let filename = format!("manual_capture_{}_{}.jpg", prefix, timestamp);
    let file_path = temp_dir.join(&filename);

    let file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, 85);
    encoder.encode_image(&image).map_err(|e| e.to_string())?;

    let _ = app.emit("manual-capture-complete", file_path.to_string_lossy().to_string());

    // Schedule picker close
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(50)).await;
        if let Some(window) = app_clone.get_webview_window("monitor-picker") {
            let _ = window.close();
        }
    });

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn capture_window_and_close_picker(
    app: AppHandle,
    state: State<'_, RecordingState>,
    window_id: u32
) -> Result<String, String> {
    use xcap::Window;
    use tokio::time::{sleep, Duration};

    // IMPORTANT: Hide highlight overlay FIRST and ensure it's destroyed
    let _ = overlay::hide_monitor_border();

    // Small delay to ensure overlay is fully destroyed
    sleep(Duration::from_millis(50)).await;

    // Hide picker window
    *state.is_picker_open.lock().unwrap() = false;
    if let Some(picker) = app.get_webview_window("monitor-picker") {
        let _ = picker.hide();
    }

    // Wait for picker to fully hide
    sleep(Duration::from_millis(150)).await;

    // Find the target window BEFORE any operations
    let windows = Window::all().map_err(|e| e.to_string())?;
    let target = windows.into_iter()
        .find(|w| w.id().ok().unwrap_or(0) == window_id)
        .ok_or("Window not found")?;

    // Restore minimized window if needed (Windows only)
    #[cfg(target_os = "windows")]
    if target.is_minimized().unwrap_or(false) {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SetForegroundWindow, SW_RESTORE};

        unsafe {
            let hwnd = HWND(window_id as isize as *mut std::ffi::c_void);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
        sleep(Duration::from_millis(300)).await;

        // Re-fetch the window after restore
        let windows = Window::all().map_err(|e| e.to_string())?;
        let target = windows.into_iter()
            .find(|w| w.id().ok().unwrap_or(0) == window_id)
            .ok_or("Window not found after restore")?;

        let image = target.capture_image().map_err(|e| e.to_string())?;
        return save_and_emit_capture(app, image, "window").await;
    }

    // Capture the window
    let image = target.capture_image().map_err(|e| e.to_string())?;
    save_and_emit_capture(app, image, "window").await
}

#[tauri::command]
async fn capture_monitor(app: AppHandle, index: usize) -> Result<String, String> {
    use xcap::Monitor;
    use image::codecs::jpeg::JpegEncoder;
    use std::io::BufWriter;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.get(index).ok_or("Invalid monitor index")?;

    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    // Save to temp file
    let temp_dir = std::env::temp_dir().join("openscribe_screenshots");
    let _ = std::fs::create_dir_all(&temp_dir);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let filename = format!("manual_capture_{}.jpg", timestamp);
    let file_path = temp_dir.join(&filename);

    let file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, 85);

    encoder.encode_image(&image).map_err(|e| e.to_string())?;

    // Emit capture event to recorder
    let _ = app.emit("manual-capture-complete", file_path.to_string_lossy().to_string());

    Ok(file_path.to_string_lossy().to_string())
}


/// Combined command that hides picker first, captures, then schedules close
/// This ensures the picker window is not visible in the screenshot
#[tauri::command]
async fn capture_monitor_and_close_picker(app: AppHandle, state: State<'_, RecordingState>, index: usize) -> Result<String, String> {
    use xcap::Monitor;
    use image::codecs::jpeg::JpegEncoder;
    use std::io::BufWriter;
    use tokio::time::{sleep, Duration};

    // Hide highlight overlay first - this is synchronous with message flush
    if let Err(e) = overlay::hide_monitor_border() {
        eprintln!("Warning: Failed to hide overlay: {}", e);
    }

    // Hide the picker window (don't close yet - we need it alive for the response)
    *state.is_picker_open.lock().unwrap() = false;
    if let Some(window) = app.get_webview_window("monitor-picker") {
        let _ = window.hide();
    }

    // Wait for picker window to fully hide
    sleep(Duration::from_millis(100)).await;

    // Now capture the monitor
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.get(index).ok_or("Invalid monitor index")?;

    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    // Save to temp file
    let temp_dir = std::env::temp_dir().join("openscribe_screenshots");
    let _ = std::fs::create_dir_all(&temp_dir);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let filename = format!("manual_capture_{}.jpg", timestamp);
    let file_path = temp_dir.join(&filename);

    let file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, 85);

    encoder.encode_image(&image).map_err(|e| e.to_string())?;

    // Emit capture event to recorder
    let _ = app.emit("manual-capture-complete", file_path.to_string_lossy().to_string());

    // Schedule the picker window to close after response is sent
    // This avoids "PostMessage failed" errors from wry when closing during active invoke
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        sleep(Duration::from_millis(50)).await;
        if let Some(window) = app_clone.get_webview_window("monitor-picker") {
            let _ = window.close();
        }
    });

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn capture_all_monitors(app: AppHandle) -> Result<String, String> {
    use xcap::Monitor;
    use image::{RgbaImage, codecs::jpeg::JpegEncoder};
    use std::io::BufWriter;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    // Calculate virtual screen bounds
    let mut min_x = i32::MAX;
    let mut min_y = i32::MAX;
    let mut max_x = i32::MIN;
    let mut max_y = i32::MIN;

    for mon in &monitors {
        let x = mon.x().unwrap_or(0);
        let y = mon.y().unwrap_or(0);
        let w = mon.width().unwrap_or(0) as i32;
        let h = mon.height().unwrap_or(0) as i32;

        min_x = min_x.min(x);
        min_y = min_y.min(y);
        max_x = max_x.max(x + w);
        max_y = max_y.max(y + h);
    }

    let total_width = (max_x - min_x) as u32;
    let total_height = (max_y - min_y) as u32;

    // Create composite image
    let mut composite = RgbaImage::new(total_width, total_height);

    for mon in monitors {
        if let Ok(img) = mon.capture_image() {
            let offset_x = (mon.x().unwrap_or(0) - min_x) as i64;
            let offset_y = (mon.y().unwrap_or(0) - min_y) as i64;
            image::imageops::overlay(&mut composite, &img, offset_x, offset_y);
        }
    }

    // Save to temp file
    let temp_dir = std::env::temp_dir().join("openscribe_screenshots");
    let _ = std::fs::create_dir_all(&temp_dir);

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();

    let filename = format!("manual_capture_all_{}.jpg", timestamp);
    let file_path = temp_dir.join(&filename);

    let file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, 85);

    let rgb_image = image::DynamicImage::ImageRgba8(composite).to_rgb8();
    encoder.encode_image(&rgb_image).map_err(|e| e.to_string())?;

    // Emit capture event
    let _ = app.emit("manual-capture-complete", file_path.to_string_lossy().to_string());

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn show_monitor_picker(app: AppHandle, state: State<'_, RecordingState>) -> Result<(), String> {
    use tauri::{WebviewWindowBuilder, WebviewUrl};

    // Always show picker UI so user can select monitors OR windows
    *state.is_picker_open.lock().unwrap() = true;

    // Close existing picker if any
    if let Some(window) = app.get_webview_window("monitor-picker") {
        let _ = window.close();
    }

    // Use hash-based URL for HashRouter compatibility
    #[cfg(debug_assertions)]
    let url = WebviewUrl::External("http://localhost:1420/#/monitor-picker".parse().unwrap());
    #[cfg(not(debug_assertions))]
    let url = WebviewUrl::App("/#/monitor-picker".into());

    // Window size for monitor cards + dropdown
    let _window = WebviewWindowBuilder::new(
        &app,
        "monitor-picker",
        url
    )
    .title("Select Capture Target")
    .inner_size(500.0, 450.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .center()
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn close_monitor_picker(app: AppHandle, state: State<'_, RecordingState>) -> Result<(), String> {
    // Always ensure the highlight overlay is hidden when picker closes
    let _ = overlay::hide_monitor_border();

    // Reset picker open flag to resume step recording
    *state.is_picker_open.lock().unwrap() = false;

    if let Some(window) = app.get_webview_window("monitor-picker") {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn show_monitor_highlight(_app: AppHandle, index: usize) -> Result<(), String> {
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.get(index).ok_or("Invalid monitor index")?;

    let x = monitor.x().unwrap_or(0);
    let y = monitor.y().unwrap_or(0);
    let width = monitor.width().unwrap_or(0);
    let height = monitor.height().unwrap_or(0);

    println!("Monitor {}: pos=({}, {}), size={}x{}", index, x, y, width, height);

    // Use native overlay instead of Tauri webview windows
    overlay::show_monitor_border(x, y, width, height)
}

#[tauri::command]
async fn hide_monitor_highlight(_app: AppHandle) -> Result<(), String> {
    // Use native overlay instead of Tauri webview windows
    overlay::hide_monitor_border()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize DPI awareness BEFORE any window/monitor operations (Windows only)
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::HiDpi::{
            SetProcessDpiAwarenessContext,
            DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
        };
        unsafe {
            let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
    }

    let recording_state = RecordingState::new();
    let is_recording_clone = recording_state.is_recording.clone();
    let is_picker_open_clone = recording_state.is_picker_open.clone();
    let start_hotkey_clone = recording_state.start_hotkey.clone();
    let stop_hotkey_clone = recording_state.stop_hotkey.clone();
    let capture_hotkey_clone = recording_state.capture_hotkey.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .manage(recording_state)
        .setup(move |app| {
            // Initialize database
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");
            let db = Database::new(app_data_dir)
                .expect("Failed to initialize database");
            app.manage(DatabaseState(Mutex::new(db)));
            // Start the global input listener in a background thread (for recording)
            recorder::start_listener(app.handle().clone(), is_recording_clone, is_picker_open_clone);

            // Register default hotkeys
            let global_shortcut = app.global_shortcut();

            let start_binding = start_hotkey_clone.lock().unwrap().clone();
            let stop_binding = stop_hotkey_clone.lock().unwrap().clone();
            let capture_binding = capture_hotkey_clone.lock().unwrap().clone();

            if let Some(shortcut) = binding_to_shortcut(&start_binding) {
                let _ = global_shortcut.on_shortcut(shortcut, |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = _app.emit("hotkey-start", ());
                    }
                });
            }

            if let Some(shortcut) = binding_to_shortcut(&stop_binding) {
                let _ = global_shortcut.on_shortcut(shortcut, |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = _app.emit("hotkey-stop", ());
                    }
                });
            }

            if let Some(shortcut) = binding_to_shortcut(&capture_binding) {
                let _ = global_shortcut.on_shortcut(shortcut, |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = _app.emit("hotkey-capture", ());
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            close_splashscreen,
            start_recording,
            stop_recording,
            delete_screenshot,
            set_hotkeys,
            create_recording,
            save_steps,
            save_steps_with_path,
            save_documentation,
            list_recordings,
            get_recording,
            delete_recording,
            update_recording_name,
            get_statistics,
            get_default_screenshot_path,
            validate_screenshot_path,
            register_asset_scope,
            save_cropped_image,
            update_step_screenshot,
            reorder_steps,
            update_step_description,
            delete_step,
            // Monitor selection commands
            get_monitors,
            capture_monitor,
            capture_monitor_and_close_picker,
            capture_all_monitors,
            show_monitor_picker,
            close_monitor_picker,
            show_monitor_highlight,
            hide_monitor_highlight,
            // Window capture commands
            get_windows,
            show_window_highlight,
            capture_window_and_close_picker
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
