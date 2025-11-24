// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod recorder;
mod accessibility;
mod database;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let recording_state = RecordingState::new();
    let is_recording_clone = recording_state.is_recording.clone();
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
            recorder::start_listener(app.handle().clone(), is_recording_clone);

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
            update_step_description
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
