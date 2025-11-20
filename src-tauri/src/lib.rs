// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod recorder;

use tauri::{AppHandle, State};
use recorder::RecordingState;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn start_recording(state: State<'_, RecordingState>, _app: AppHandle) {
    let mut is_recording = state.is_recording.lock().unwrap();
    if !*is_recording {
        *is_recording = true;
        println!("Recording started");
        // We might need to start the listener only once, or check if it's running.
        // For simplicity in this design, the listener is always running but checks the flag.
        // However, rdev listener blocks the thread.
        // In main.rs/lib.rs setup, we should spawn the listener once.
    }
}

#[tauri::command]
fn stop_recording(state: State<'_, RecordingState>) {
    let mut is_recording = state.is_recording.lock().unwrap();
    *is_recording = false;
    println!("Recording stopped");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let recording_state = RecordingState::new();
    let is_recording_clone = recording_state.is_recording.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(recording_state)
        .setup(move |app| {
            // Start the global listener in a background thread
            recorder::start_listener(app.handle().clone(), is_recording_clone);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet, start_recording, stop_recording])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
