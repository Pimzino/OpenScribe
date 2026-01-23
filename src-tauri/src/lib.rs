// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod recorder;
mod accessibility;
mod database;
mod overlay;
mod ocr;

#[cfg(target_os = "linux")]
mod display;

use std::sync::Mutex;
use std::path::PathBuf;
use std::io::Write;
use std::panic::{catch_unwind, AssertUnwindSafe};
use tauri::{AppHandle, State, Manager, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use recorder::{RecordingState, HotkeyBinding};
use database::{Database, StepInput, Recording, RecordingWithSteps, DeleteRecordingCleanup, PaginatedRecordings};

pub struct DatabaseState(pub Mutex<Database>);

// Show main window - called from frontend once React has mounted
#[tauri::command]
async fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
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
fn list_recordings_paginated(
    db: State<'_, DatabaseState>,
    page: i32,
    per_page: i32,
    search: Option<String>
) -> Result<PaginatedRecordings, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .list_recordings_paginated(page, per_page, search.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recording(db: State<'_, DatabaseState>, id: String) -> Result<Option<RecordingWithSteps>, String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .get_recording(&id)
        .map_err(|e| e.to_string())
}

/// Progress event payload for delete operations
#[derive(Clone, serde::Serialize)]
struct DeleteProgress {
    phase: String,
    current: u32,
    total: u32,
    message: String,
}

#[tauri::command]
fn delete_recording(db: State<'_, DatabaseState>, id: String, app: AppHandle) -> Result<(), String> {
    use std::fs;
    use std::io;

    // Emit initial progress
    let _ = app.emit("delete-progress", DeleteProgress {
        phase: "preparing".to_string(),
        current: 0,
        total: 0,
        message: "Preparing to delete recording...".to_string(),
    });

    // Get cleanup info from database (this also deletes DB records)
    let cleanup: DeleteRecordingCleanup = {
        let db = db.0.lock().map_err(|e| e.to_string())?;
        db.delete_recording(&id).map_err(|e| e.to_string())?
    };

    // Emit database deletion complete
    let _ = app.emit("delete-progress", DeleteProgress {
        phase: "database".to_string(),
        current: 1,
        total: 1,
        message: "Database records removed".to_string(),
    });

    let total_files = cleanup.files.len() as u32;
    let mut deleted_count: u32 = 0;
    let mut warnings: Vec<String> = Vec::new();

    // Delete screenshot files synchronously with progress
    for file in &cleanup.files {
        let filename = file.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());
        
        let _ = app.emit("delete-progress", DeleteProgress {
            phase: "screenshots".to_string(),
            current: deleted_count + 1,
            total: total_files,
            message: format!("Deleting screenshot: {}", filename),
        });

        match fs::remove_file(file) {
            Ok(_) => deleted_count += 1,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                // File already gone, count as success
                deleted_count += 1;
            }
            Err(e) => {
                warnings.push(format!("Failed to remove {:?}: {}", file, e));
                deleted_count += 1; // Still increment to keep progress moving
            }
        }
    }

    // Remove directories deepest-first, skipping protected dirs
    let mut dirs: Vec<PathBuf> = cleanup.dirs;
    dirs.sort_by_key(|d| std::cmp::Reverse(d.components().count()));

    let total_dirs = dirs.len() as u32;
    let mut dir_count: u32 = 0;

    for dir in dirs {
        if dir == cleanup.protected_dir {
            continue;
        }

        dir_count += 1;
        let dirname = dir.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "folder".to_string());

        let _ = app.emit("delete-progress", DeleteProgress {
            phase: "directories".to_string(),
            current: dir_count,
            total: total_dirs,
            message: format!("Cleaning up folder: {}", dirname),
        });

        match fs::remove_dir(&dir) {
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) if e.kind() == io::ErrorKind::DirectoryNotEmpty => {}
            Err(e) => {
                warnings.push(format!("Failed to remove dir {:?}: {}", dir, e));
            }
        }
    }

    // Emit completion
    let final_message = if warnings.is_empty() {
        "Recording deleted successfully".to_string()
    } else {
        format!("Recording deleted with {} warning(s)", warnings.len())
    };

    let _ = app.emit("delete-progress", DeleteProgress {
        phase: "complete".to_string(),
        current: total_files,
        total: total_files,
        message: final_message,
    });

    // Log any warnings to stderr for debugging
    for warning in &warnings {
        eprintln!("Delete warning: {}", warning);
    }

    Ok(())
}

#[tauri::command]
fn update_recording_name(db: State<'_, DatabaseState>, id: String, name: String) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .update_recording_name(&id, &name)
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

/// Copy a screenshot from temp location to permanent storage immediately.
/// Used when recording additional steps for an existing recording so images display immediately.
#[tauri::command]
fn copy_screenshot_to_permanent(
    db: State<'_, DatabaseState>,
    temp_path: String,
    recording_id: String,
    recording_name: String,
    custom_screenshot_path: Option<String>
) -> Result<String, String> {
    use uuid::Uuid;

    let temp_path_buf = PathBuf::from(&temp_path);
    if !temp_path_buf.exists() {
        return Err(format!("Temp screenshot not found: {}", temp_path));
    }

    // Get the base directory (custom path or default)
    let base_dir = match custom_screenshot_path {
        Some(ref path) if !path.is_empty() => PathBuf::from(path),
        _ => db.0.lock()
            .map_err(|e| e.to_string())?
            .screenshots_dir(),
    };

    // Create recording-specific subfolder with sanitized name
    let sanitized_name = database::Database::sanitize_dirname_public(&recording_name);
    let screenshots_dir = base_dir.join(&sanitized_name);
    std::fs::create_dir_all(&screenshots_dir)
        .map_err(|e| format!("Failed to create screenshots directory: {}", e))?;

    // Generate unique filename
    let step_id = Uuid::new_v4().to_string();
    let filename = format!("{}_{}.jpg", recording_id, step_id);
    let dest_path = screenshots_dir.join(&filename);

    // Copy the file
    std::fs::copy(&temp_path_buf, &dest_path)
        .map_err(|e| format!("Failed to copy screenshot: {}", e))?;

    // Delete the temp file
    let _ = std::fs::remove_file(&temp_path_buf);

    Ok(dest_path.to_string_lossy().to_string())
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

// Bounds for highlight overlay (passed from frontend)
#[derive(Clone, serde::Deserialize)]
pub struct HighlightBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
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
#[allow(unused_variables)]
fn is_capturable_window(title: &str, app_name: &str) -> bool {
    // Filter empty titles
    if title.trim().is_empty() {
        return false;
    }

    // Filter own windows
    if title.contains("OpenScribe") || title.contains("Select Capture") || title.contains("monitor-picker") {
        return false;
    }

    // Windows-specific system windows
    #[cfg(target_os = "windows")]
    {
        let system_titles = [
            "Program Manager",
            "Windows Input Experience",
            "Microsoft Text Input Application",
            "Settings",
            "MSCTFIME UI",
            "Default IME",
        ];
        if system_titles.iter().any(|s| title.eq_ignore_ascii_case(s)) {
            return false;
        }
    }

    // macOS-specific system windows and apps
    #[cfg(target_os = "macos")]
    {
        // Filter system app names
        let system_apps = [
            "Dock",
            "Window Server",
            "SystemUIServer",
            "Control Center",
            "Notification Center",
            "NotificationCenter",
            "Spotlight",
            "Siri",
            "AirPlayUIAgent",
            "TextInputMenuAgent",
            "CoreServicesUIAgent",
            "universalAccessAuthWarn",
            "talagent",
        ];
        if system_apps.iter().any(|s| app_name.eq_ignore_ascii_case(s)) {
            return false;
        }

        // Filter system window titles
        let system_titles = [
            "Menu Bar",
            "Menubar",
            "Item-0",  // Menu bar items
            "Notification Center",
            "Focus",   // Focus mode overlay
        ];
        if system_titles.iter().any(|s| title.eq_ignore_ascii_case(s)) {
            return false;
        }

        // Filter windows that are just app names with no real title (common for background processes)
        if title == app_name && system_apps.iter().any(|s| app_name.contains(s)) {
            return false;
        }
    }

    // Linux-specific system windows
    #[cfg(target_os = "linux")]
    {
        let system_titles = [
            "Desktop",
            "gnome-shell",
            "mutter",
            "plasmashell",
            "kwin",
        ];
        if system_titles.iter().any(|s| title.eq_ignore_ascii_case(s)) {
            return false;
        }
    }

    true
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

#[tauri::command]
async fn show_highlight_at_bounds(bounds: HighlightBounds) -> Result<(), String> {
    // Skip invalid bounds (minimized windows have 0 dimensions or off-screen positions)
    if bounds.width == 0 || bounds.height == 0 {
        return Ok(());
    }
    if bounds.width > 10000 || bounds.height > 10000 {
        return Err("Invalid window bounds".to_string());
    }
    if bounds.x < -10000 || bounds.y < -10000 {
        return Ok(());
    }

    overlay::show_monitor_border(bounds.x, bounds.y, bounds.width, bounds.height)
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

    // Show native toast notification (2.5 seconds)
    let _ = overlay::show_toast("Screenshot captured", 2500);

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

/// Check if a window handle is still valid on Windows
#[cfg(target_os = "windows")]
fn is_window_valid(window_id: u32) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindow;
    unsafe {
        let hwnd = HWND(window_id as isize as *mut std::ffi::c_void);
        IsWindow(hwnd).as_bool()
    }
}

/// Check if a window ID is still valid on macOS
/// Uses CGWindowListCopyWindowInfo to check if the window exists
#[cfg(target_os = "macos")]
fn is_window_valid(window_id: u32) -> bool {
    use core_foundation::array::CFArrayRef;
    use core_foundation::base::CFRelease;

    // CGWindowListOption flags
    const K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW: u32 = 1 << 3;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGWindowListCopyWindowInfo(option: u32, relative_to_window: u32) -> CFArrayRef;
        fn CFArrayGetCount(array: CFArrayRef) -> isize;
    }

    unsafe {
        // Query for this specific window
        let window_list = CGWindowListCopyWindowInfo(
            K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW,
            window_id,
        );

        if window_list.is_null() {
            return false;
        }

        let count = CFArrayGetCount(window_list);
        CFRelease(window_list as *const _);

        // If the array has at least one entry, the window exists
        count > 0
    }
}

/// Get the app name for a window ID on macOS
#[cfg(target_os = "macos")]
fn get_app_name_for_window(window_id: u32) -> Option<String> {
    use xcap::Window;

    if let Ok(windows) = Window::all() {
        for window in windows {
            if window.id().ok() == Some(window_id) {
                return window.app_name().ok();
            }
        }
    }
    None
}

/// Restore a minimized window on macOS using AppleScript
#[cfg(target_os = "macos")]
fn restore_macos_window(app_name: &str) -> Result<(), String> {
    use std::process::Command;

    // AppleScript to activate the app and unminimize its windows
    // This brings the app to the front and restores any minimized windows
    let script = format!(r#"
        tell application "{}"
            activate
        end tell
        delay 0.1
        tell application "System Events"
            tell process "{}"
                set frontmost to true
                repeat with w in windows
                    try
                        if miniaturized of w is true then
                            set miniaturized of w to false
                        end if
                    end try
                end repeat
            end tell
        end tell
    "#, app_name, app_name);

    let output = Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("Failed to run AppleScript: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("AppleScript warning (may be ignorable): {}", stderr);
        // Don't fail on AppleScript errors - the window might still be usable
    }

    Ok(())
}

/// Safe wrapper for mutex lock that handles poisoned mutexes
fn safe_mutex_set<T>(mutex: &Mutex<T>, value: T)
where
    T: Copy,
{
    match mutex.lock() {
        Ok(mut guard) => *guard = value,
        Err(poisoned) => {
            eprintln!("Mutex poisoned, recovering");
            *poisoned.into_inner() = value;
        }
    }
}

#[tauri::command]
async fn capture_window_and_close_picker(
    app: AppHandle,
    state: State<'_, RecordingState>,
    window_id: u32,
    is_minimized: bool
) -> Result<String, String> {
    use xcap::Window;
    use tokio::time::{sleep, Duration};

    // IMPORTANT: Hide highlight overlay FIRST and ensure it's destroyed
    let _ = overlay::hide_monitor_border();

    // Small delay to ensure overlay is fully destroyed
    sleep(Duration::from_millis(50)).await;

    // Hide picker window - use safe mutex handling
    safe_mutex_set(&state.is_picker_open, false);
    if let Some(picker) = app.get_webview_window("monitor-picker") {
        let _ = picker.hide();
    }

    // Wait for picker to fully hide
    sleep(Duration::from_millis(150)).await;

    // Validate window still exists before any operations
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if !is_window_valid(window_id) {
        return Err("Window no longer exists".to_string());
    }

    // Restore minimized window BEFORE calling Window::all() to avoid xcap hanging
    // We use is_minimized from frontend since it already has this info from get_windows()
    #[cfg(target_os = "windows")]
    if is_minimized {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SetForegroundWindow, SW_RESTORE};

        unsafe {
            let hwnd = HWND(window_id as isize as *mut std::ffi::c_void);
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
        // Wait for window to fully restore before capturing
        sleep(Duration::from_millis(400)).await;
    }

    // Validate window still exists after potential restore
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    if !is_window_valid(window_id) {
        return Err("Window became invalid during restore".to_string());
    }

    // Restore minimized window on macOS using AppleScript
    #[cfg(target_os = "macos")]
    if is_minimized {
        // Get the app name for this window so we can target it with AppleScript
        if let Some(app_name) = get_app_name_for_window(window_id) {
            if let Err(e) = restore_macos_window(&app_name) {
                eprintln!("Warning: Failed to restore macOS window: {}", e);
                // Continue anyway - the window might still be capturable
            }
            // Wait for window to fully restore before capturing
            sleep(Duration::from_millis(500)).await;
        } else {
            eprintln!("Warning: Could not find app name for window {}", window_id);
        }
    }

    // Now it's safe to call Window::all() - the window is restored if it was minimized
    let windows = Window::all().map_err(|e| e.to_string())?;
    let target = windows.into_iter()
        .find(|w| w.id().ok().unwrap_or(0) == window_id)
        .ok_or("Window not found")?;

    // Validate window has valid dimensions before capture
    let target_width = target.width().unwrap_or(0);
    let target_height = target.height().unwrap_or(0);
    if target_width == 0 || target_height == 0 {
        return Err("Window has invalid dimensions".to_string());
    }

    // Safely attempt capture with panic recovery
    let capture_result = catch_unwind(AssertUnwindSafe(|| {
        target.capture_image()
    }));

    let image = match capture_result {
        Ok(Ok(img)) => img,
        Ok(Err(e)) => return Err(format!("Capture failed: {}", e)),
        Err(_) => return Err("Window capture crashed - window may be invalid".to_string()),
    };

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


/// Combined command that closes picker first, then captures the monitor
/// The picker window is closed (not just hidden) to ensure it's fully removed
/// from the screen before capturing, preventing "ghost window" artifacts
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

    // Close the picker window entirely to ensure it's not captured in the screenshot
    // (hiding alone is not reliable - Windows compositor may not update in time)
    safe_mutex_set(&state.is_picker_open, false);
    if let Some(window) = app.get_webview_window("monitor-picker") {
        let _ = window.close();
    }

    // Wait for picker window to fully close and compositor to update
    sleep(Duration::from_millis(200)).await;

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

    // Show native toast notification (2.5 seconds)
    let _ = overlay::show_toast("Screenshot captured", 2500);

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
    safe_mutex_set(&state.is_picker_open, true);

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
    .inner_size(500.0, 520.0)
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
    safe_mutex_set(&state.is_picker_open, false);

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

// OCR commands
#[tauri::command]
fn set_ocr_enabled(state: State<'_, RecordingState>, enabled: bool) {
    *state.ocr_enabled.lock().unwrap() = enabled;
}

#[tauri::command]
fn get_ocr_enabled(state: State<'_, RecordingState>) -> bool {
    *state.ocr_enabled.lock().unwrap()
}

#[tauri::command]
fn update_step_ocr(
    db: State<'_, DatabaseState>,
    step_id: String,
    ocr_text: Option<String>,
    ocr_status: String,
) -> Result<(), String> {
    db.0.lock()
        .map_err(|e| e.to_string())?
        .update_step_ocr(&step_id, ocr_text.as_deref(), &ocr_status)
        .map_err(|e| e.to_string())
}

// Permission status response
#[derive(Clone, serde::Serialize)]
pub struct PermissionStatus {
    pub screen_recording: bool,
    pub accessibility: bool,
}

/// Check if screen recording permission is granted on macOS
/// Returns true on other platforms (no permission needed)
#[tauri::command]
fn check_screen_recording_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            // Available on macOS 10.15+
            fn CGPreflightScreenCaptureAccess() -> bool;
        }

        unsafe { CGPreflightScreenCaptureAccess() }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true // No permission needed on other platforms
    }
}

/// Request screen recording permission on macOS
/// This will show the system permission dialog if not already granted
/// Returns true if permission was granted, false otherwise
#[tauri::command]
fn request_screen_recording_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        extern "C" {
            // Available on macOS 10.15+
            fn CGRequestScreenCaptureAccess() -> bool;
        }

        unsafe { CGRequestScreenCaptureAccess() }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true // No permission needed on other platforms
    }
}

/// Check if accessibility permission is granted on macOS
/// This is needed for the accessibility API to read UI element info
#[tauri::command]
fn check_accessibility_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "ApplicationServices", kind = "framework")]
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }

        unsafe { AXIsProcessTrusted() }
    }

    #[cfg(not(target_os = "macos"))]
    {
        true // No permission needed on other platforms
    }
}

/// Request accessibility permission on macOS
/// This opens System Preferences to the Accessibility pane
#[tauri::command]
fn request_accessibility_permission() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;

        // Open System Preferences to the Accessibility pane
        // Using the Privacy & Security > Accessibility path
        Command::new("open")
            .args(["x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"])
            .spawn()
            .map_err(|e| format!("Failed to open System Preferences: {}", e))?;

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(()) // No permission needed on other platforms
    }
}

/// Get all permission statuses at once
#[tauri::command]
fn get_permission_status() -> PermissionStatus {
    PermissionStatus {
        screen_recording: check_screen_recording_permission(),
        accessibility: check_accessibility_permission(),
    }
}

/// Update paths in settings.json that reference the old identifier.
/// This is called after a successful folder migration.
fn update_settings_paths(settings_path: &std::path::Path, old_identifier: &str, new_identifier: &str) {
    // Read settings file if it exists
    let content = match std::fs::read_to_string(settings_path) {
        Ok(c) => c,
        Err(_) => return, // No settings file to update
    };
    
    // Check if the old identifier is present in the content
    if !content.contains(old_identifier) {
        return; // Nothing to update
    }
    
    // Replace old identifier with new identifier in all paths
    let updated_content = content.replace(old_identifier, new_identifier);
    
    // Write back the updated settings
    if let Err(e) = std::fs::write(settings_path, updated_content) {
        eprintln!("Warning: Could not update paths in settings.json: {}", e);
    } else {
        println!("Updated paths in settings.json: {} -> {}", old_identifier, new_identifier);
    }
}

/// Migrate data from old "com.openscribe" identifier location to new "openscribe" location.
/// Returns Ok(Some(message)) if user notification is needed, Ok(None) if silent success or nothing to do.
fn migrate_from_old_identifier(new_data_dir: &std::path::Path) -> Result<Option<String>, String> {
    // Get parent directory (e.g., %APPDATA% on Windows)
    let parent = match new_data_dir.parent() {
        Some(p) => p,
        None => return Ok(None),
    };
    
    // Old location with "com.openscribe" identifier
    let old_data_dir = parent.join("com.openscribe");
    
    // Check if old location exists
    if !old_data_dir.exists() {
        return Ok(None); // Nothing to migrate
    }
    
    // Check if old location has a valid database (required for migration)
    let old_db_path = old_data_dir.join("openscribe.db");
    if !old_db_path.exists() {
        return Ok(None); // No database to migrate
    }
    
    // Check if new location already exists
    if new_data_dir.exists() {
        // Both locations exist - user needs to manually resolve
        return Ok(Some(format!(
            "Data exists in both old and new locations. You may want to manually check: {}",
            old_data_dir.display()
        )));
    }
    
    // Attempt to rename old folder to new location
    match std::fs::rename(&old_data_dir, new_data_dir) {
        Ok(_) => {
            println!("Successfully migrated data from {} to {}", 
                     old_data_dir.display(), new_data_dir.display());
            
            // Update paths in settings.json that reference the old identifier
            let settings_path = new_data_dir.join("settings.json");
            update_settings_paths(&settings_path, "com.openscribe", "openscribe");
            
            Ok(None) // Silent success
        }
        Err(e) => {
            // Migration failed - notify user
            Ok(Some(format!(
                "Could not migrate data from old location. Your data may be at: {} (Error: {})",
                old_data_dir.display(), e
            )))
        }
    }
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
    let ocr_enabled_clone = recording_state.ocr_enabled.clone();
    let start_hotkey_clone = recording_state.start_hotkey.clone();
    let stop_hotkey_clone = recording_state.stop_hotkey.clone();
    let capture_hotkey_clone = recording_state.capture_hotkey.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(recording_state)
        .setup(move |app| {
            // Initialize database
            let app_data_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");
            
            // Migrate from old "com.openscribe" identifier if needed
            if let Ok(Some(warning_message)) = migrate_from_old_identifier(&app_data_dir) {
                // Emit warning to frontend - user may need to take action
                let app_handle = app.handle().clone();
                let msg = warning_message.clone();
                std::thread::spawn(move || {
                    // Small delay to ensure frontend is ready
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let _ = app_handle.emit("migration-warning", msg);
                });
            }
            
            let db = Database::new(app_data_dir)
                .expect("Failed to initialize database");
            app.manage(DatabaseState(Mutex::new(db)));

            // Start the global input listener in a background thread (for recording)
            recorder::start_listener(app.handle().clone(), is_recording_clone, is_picker_open_clone, ocr_enabled_clone);

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
            show_main_window,
            start_recording,
            stop_recording,
            delete_screenshot,
            set_hotkeys,
            create_recording,
            save_steps,
            save_steps_with_path,
            save_documentation,
            list_recordings,
            list_recordings_paginated,
            get_recording,
            delete_recording,
            update_recording_name,
            get_default_screenshot_path,
            validate_screenshot_path,
            register_asset_scope,
            save_cropped_image,
            copy_screenshot_to_permanent,
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
            show_highlight_at_bounds,
            capture_window_and_close_picker,
            // OCR commands
            set_ocr_enabled,
            get_ocr_enabled,
            update_step_ocr,
            // Permission commands (macOS)
            check_screen_recording_permission,
            request_screen_recording_permission,
            check_accessibility_permission,
            request_accessibility_permission,
            get_permission_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
