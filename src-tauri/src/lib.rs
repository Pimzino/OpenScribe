// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod accessibility;
mod database;
mod ocr;
mod overlay;
mod recorder;

#[cfg(target_os = "linux")]
mod display;

use base64::{engine::general_purpose, Engine as _};
use database::{
    Database, DeleteRecordingCleanup, Notification, PaginatedRecordings, Recording,
    RecordingWithSteps, StepInput,
};
use recorder::{HotkeyBinding, RecordingState};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::net::{IpAddr, ToSocketAddrs};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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

/// Normalize an absolute file path into a stable canonical path.
/// If the file does not exist yet, canonicalize the nearest existing parent and
/// append the final file name so first-run writes still work.
fn normalize_file_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("Path must be absolute: {}", path.display()));
    }

    if path.exists() {
        return path
            .canonicalize()
            .map_err(|e| format!("Invalid path: {}", e));
    }

    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: {}", path.display()))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Path has no file name: {}", path.display()))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;

    Ok(canonical_parent.join(file_name))
}

/// Normalize an absolute directory path into a stable canonical path.
/// If the directory does not exist yet, canonicalize the nearest existing parent and
/// append the final directory name so the caller can create it afterwards.
fn normalize_directory_path(path: &std::path::Path) -> Result<std::path::PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("Path must be absolute: {}", path.display()));
    }

    if path.exists() {
        if !path.is_dir() {
            return Err(format!("Path is not a directory: {}", path.display()));
        }
        return path
            .canonicalize()
            .map_err(|e| format!("Invalid path: {}", e));
    }

    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent directory: {}", path.display()))?;
    let dir_name = path
        .file_name()
        .ok_or_else(|| format!("Path has no directory name: {}", path.display()))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Invalid path: {}", e))?;

    Ok(canonical_parent.join(dir_name))
}

fn normalize_optional_directory_path(path: Option<String>) -> Result<Option<PathBuf>, String> {
    match path {
        Some(path) if !path.trim().is_empty() => {
            let normalized = normalize_directory_path(std::path::Path::new(&path))?;
            Ok(Some(normalized))
        }
        _ => Ok(None),
    }
}

fn read_validated_file_bytes(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let validated_path = normalize_file_path(path)?;
    std::fs::read(&validated_path).map_err(|e| format!("Failed to read file: {}", e))
}

fn write_bytes_to_file(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let validated_path = normalize_file_path(path)?;

    if let Some(parent) = validated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    let mut file = std::fs::File::create(&validated_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(data)
        .map_err(|e| format!("Failed to write file: {}", e))
}

fn is_private_or_local_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => ipv4.is_private() || ipv4.is_loopback() || ipv4.is_link_local(),
        IpAddr::V6(ipv6) => {
            let first_segment = ipv6.segments()[0];
            ipv6.is_loopback()
                || ipv6.is_unicast_link_local()
                || (first_segment & 0xfe00) == 0xfc00
        }
    }
}

fn is_allowed_insecure_host(host: &str, port: u16) -> bool {
    if host.eq_ignore_ascii_case("localhost")
        || host.eq_ignore_ascii_case("host.docker.internal")
        || host.ends_with(".local")
    {
        return true;
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_private_or_local_ip(&ip);
    }

    let mut saw_address = false;
    let lookup_target = format!("{host}:{port}");
    if let Ok(addresses) = lookup_target.to_socket_addrs() {
        for address in addresses {
            saw_address = true;
            if !is_private_or_local_ip(&address.ip()) {
                return false;
            }
        }
    }

    saw_address
}

fn validate_ai_base_url(base_url: &str) -> Result<reqwest::Url, String> {
    let trimmed = base_url.trim();
    if trimmed.is_empty() {
        return Err("Base URL is required.".to_string());
    }

    let url = reqwest::Url::parse(trimmed).map_err(|e| format!("Invalid base URL: {}", e))?;
    let scheme = url.scheme();

    if scheme != "http" && scheme != "https" {
        return Err("Base URL must use http or https.".to_string());
    }

    if !url.username().is_empty() || url.password().is_some() {
        return Err("Base URL must not include embedded credentials.".to_string());
    }

    if scheme == "http" {
        let host = url
            .host_str()
            .ok_or_else(|| "Base URL must include a hostname.".to_string())?;
        let port = url.port_or_known_default().unwrap_or(80);

        if !is_allowed_insecure_host(host, port) {
            return Err(
                "Plain HTTP is only allowed for localhost or private-network AI endpoints."
                    .to_string(),
            );
        }
    }

    Ok(url)
}

fn build_ai_endpoint(base_url: &reqwest::Url, path: &str) -> Result<reqwest::Url, String> {
    let full_url = format!(
        "{}/{}",
        base_url.as_str().trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    reqwest::Url::parse(&full_url).map_err(|e| format!("Invalid endpoint URL: {}", e))
}

fn ai_http_client(timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Failed to create AI HTTP client: {}", e))
}

fn map_ai_transport_error(error: &reqwest::Error, base_url: &reqwest::Url) -> String {
    if error.is_timeout() {
        return "Connection timed out. Check the server URL.".to_string();
    }

    if error.is_connect() {
        let host = base_url.host_str().unwrap_or_default();
        let is_local_server = host.eq_ignore_ascii_case("localhost")
            || host == "127.0.0.1"
            || host == "::1"
            || host.eq_ignore_ascii_case("host.docker.internal");

        if is_local_server {
            return format!(
                "Cannot connect to {}. Make sure your local AI server is running.",
                base_url
            );
        }

        return format!(
            "Connection failed to {}. Please check that the server is running and accessible.",
            base_url
        );
    }

    format!("Connection failed: {}", error)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiRetryConfig {
    enable_auto_retry: bool,
    max_retry_attempts: u32,
    initial_retry_delay_ms: u64,
}

impl Default for AiRetryConfig {
    fn default() -> Self {
        Self {
            enable_auto_retry: true,
            max_retry_attempts: 3,
            initial_retry_delay_ms: 1000,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AiConnectionResult {
    success: bool,
    message: String,
    models: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct SaveFileFilter {
    name: String,
    extensions: Vec<String>,
}

async fn post_ai_chat_completion(
    base_url: &reqwest::Url,
    api_key: &str,
    body: &serde_json::Value,
    retry_config: &AiRetryConfig,
) -> Result<String, String> {
    let endpoint = build_ai_endpoint(base_url, "chat/completions")?;
    let client = ai_http_client(Duration::from_secs(120))?;
    let max_attempts = if retry_config.enable_auto_retry {
        retry_config.max_retry_attempts
    } else {
        0
    };
    let mut attempt = 0;

    loop {
        let mut request = client
            .post(endpoint.clone())
            .header("Content-Type", "application/json")
            .json(body);

        if !api_key.is_empty() {
            request = request.bearer_auth(api_key);
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => {
                if retry_config.enable_auto_retry && !error.is_timeout() && attempt < max_attempts {
                    let delay_ms =
                        retry_config.initial_retry_delay_ms.saturating_mul(2_u64.pow(attempt));
                    tokio::time::sleep(Duration::from_millis(delay_ms.min(60_000))).await;
                    attempt += 1;
                    continue;
                }

                return Err(map_ai_transport_error(&error, base_url));
            }
        };

        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
            && retry_config.enable_auto_retry
            && attempt < max_attempts
        {
            let retry_after_ms = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok())
                .map(|seconds| seconds.saturating_mul(1000))
                .unwrap_or_else(|| {
                    retry_config
                        .initial_retry_delay_ms
                        .saturating_mul(2_u64.pow(attempt))
                });

            tokio::time::sleep(Duration::from_millis(retry_after_ms.min(60_000))).await;
            attempt += 1;
            continue;
        }

        if !response.status().is_success() {
            let status = response.status();
            let error_body: serde_json::Value = response
                .json()
                .await
                .unwrap_or_else(|_| serde_json::json!({}));
            let provider_message = error_body
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(|message| message.as_str())
                .unwrap_or_default();

            if status == reqwest::StatusCode::UNAUTHORIZED {
                return Err("Authentication failed. Please check your API key in Settings.".to_string());
            }
            if status == reqwest::StatusCode::NOT_FOUND {
                if let Some(model) = body.get("model").and_then(|value| value.as_str()) {
                    return Err(format!(
                        "Model \"{}\" not found. Please verify the model name in Settings.",
                        model
                    ));
                }
                return Err("Requested AI endpoint was not found.".to_string());
            }
            if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                return Err(
                    "Rate limit exceeded after all retries. Try increasing retry settings or wait before trying again."
                        .to_string(),
                );
            }
            if status.is_server_error() {
                return Err("The AI server is experiencing issues. Please try again later.".to_string());
            }

            let extra = if provider_message.is_empty() {
                String::new()
            } else {
                format!(" - {}", provider_message)
            };
            return Err(format!(
                "AI request failed: {} {}{}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("Unknown"),
                extra
            ));
        }

        let response_body: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Invalid AI response: {}", e))?;

        let content = response_body
            .get("choices")
            .and_then(|choices| choices.as_array())
            .and_then(|choices| choices.first())
            .and_then(|choice| {
                choice
                    .get("message")
                    .and_then(|message| message.get("content"))
                    .and_then(|content| content.as_str())
                    .or_else(|| choice.get("text").and_then(|text| text.as_str()))
            })
            .unwrap_or_default()
            .trim()
            .to_string();

        return Ok(content);
    }
}

#[tauri::command]
fn delete_screenshot(path: String, db: State<'_, DatabaseState>) -> Result<(), String> {
    let path = PathBuf::from(&path);
    drop(safe_db_lock(&db)?);
    let validated_path = normalize_file_path(&path)?;
    std::fs::remove_file(&validated_path).map_err(|e| e.to_string())
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
fn set_hotkeys(
    app: AppHandle,
    state: State<'_, RecordingState>,
    start: HotkeyBinding,
    stop: HotkeyBinding,
    capture: Option<HotkeyBinding>,
) -> Result<(), String> {
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
        global_shortcut
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = _app.emit("hotkey-start", ());
                }
            })
            .map_err(|e| e.to_string())?;
    }

    if let Some(shortcut) = binding_to_shortcut(&stop) {
        global_shortcut
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = _app.emit("hotkey-stop", ());
                }
            })
            .map_err(|e| e.to_string())?;
    }

    // Register capture hotkey if provided
    let capture_binding = capture.unwrap_or_else(|| old_capture.clone());
    if let Some(shortcut) = binding_to_shortcut(&capture_binding) {
        global_shortcut
            .on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = _app.emit("hotkey-capture", ());
                }
            })
            .map_err(|e| e.to_string())?;
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
    safe_db_lock(&db)?
        .create_recording(name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_steps(
    db: State<'_, DatabaseState>,
    recording_id: String,
    steps: Vec<StepInput>,
) -> Result<(), String> {
    safe_db_lock(&db)?
        .save_steps(&recording_id, steps)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_documentation(
    db: State<'_, DatabaseState>,
    recording_id: String,
    documentation: String,
) -> Result<(), String> {
    safe_db_lock(&db)?
        .save_documentation(&recording_id, &documentation)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_recordings(db: State<'_, DatabaseState>) -> Result<Vec<Recording>, String> {
    safe_db_lock(&db)?
        .list_recordings()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_recordings_paginated(
    db: State<'_, DatabaseState>,
    page: i32,
    per_page: i32,
    search: Option<String>,
) -> Result<PaginatedRecordings, String> {
    safe_db_lock(&db)?
        .list_recordings_paginated(page, per_page, search.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recording(
    db: State<'_, DatabaseState>,
    id: String,
) -> Result<Option<RecordingWithSteps>, String> {
    safe_db_lock(&db)?
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
fn delete_recording(
    db: State<'_, DatabaseState>,
    id: String,
    app: AppHandle,
) -> Result<(), String> {
    use std::fs;
    use std::io;

    // Emit initial progress
    let _ = app.emit(
        "delete-progress",
        DeleteProgress {
            phase: "preparing".to_string(),
            current: 0,
            total: 0,
            message: "Preparing to delete recording...".to_string(),
        },
    );

    // Get cleanup info from database (this also deletes DB records)
    let cleanup: DeleteRecordingCleanup = {
        let db = safe_db_lock(&db)?;
        db.delete_recording(&id).map_err(|e| e.to_string())?
    };

    // Emit database deletion complete
    let _ = app.emit(
        "delete-progress",
        DeleteProgress {
            phase: "database".to_string(),
            current: 1,
            total: 1,
            message: "Database records removed".to_string(),
        },
    );

    let total_files = cleanup.files.len() as u32;
    let mut deleted_count: u32 = 0;
    let mut warnings: Vec<String> = Vec::new();

    // Delete screenshot files synchronously with progress
    for file in &cleanup.files {
        let filename = file
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());

        let _ = app.emit(
            "delete-progress",
            DeleteProgress {
                phase: "screenshots".to_string(),
                current: deleted_count + 1,
                total: total_files,
                message: format!("Deleting screenshot: {}", filename),
            },
        );

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
        let dirname = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "folder".to_string());

        let _ = app.emit(
            "delete-progress",
            DeleteProgress {
                phase: "directories".to_string(),
                current: dir_count,
                total: total_dirs,
                message: format!("Cleaning up folder: {}", dirname),
            },
        );

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

    let _ = app.emit(
        "delete-progress",
        DeleteProgress {
            phase: "complete".to_string(),
            current: total_files,
            total: total_files,
            message: final_message,
        },
    );

    // Log any warnings to stderr for debugging
    for warning in &warnings {
        eprintln!("Delete warning: {}", warning);
    }

    Ok(())
}

#[tauri::command]
fn update_recording_name(
    db: State<'_, DatabaseState>,
    id: String,
    name: String,
) -> Result<(), String> {
    safe_db_lock(&db)?
        .update_recording_name(&id, &name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_default_screenshot_path(db: State<'_, DatabaseState>) -> Result<String, String> {
    let path = safe_db_lock(&db)?.get_default_screenshot_path();
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
    let test_file = path.join(".stepsnap_write_test");
    match std::fs::write(&test_file, "test") {
        Ok(_) => {
            let _ = std::fs::remove_file(&test_file);
            Ok(true)
        }
        Err(e) => Err(format!("Directory is not writable: {}", e)),
    }
}

#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    let bytes = read_validated_file_bytes(std::path::Path::new(&path))?;
    Ok(general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    read_validated_file_bytes(std::path::Path::new(&path))
}

#[tauri::command]
fn save_file_via_dialog(
    app: AppHandle,
    data: Vec<u8>,
    default_name: String,
    filters: Vec<SaveFileFilter>,
) -> Result<bool, String> {
    let mut dialog = app.dialog().file().set_file_name(default_name);

    for filter in &filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(|extension| extension.as_str()).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }

    let Some(path) = dialog.blocking_save_file() else {
        return Ok(false);
    };

    let selected_path = path
        .into_path()
        .map_err(|e| format!("Invalid save path: {}", e))?;

    write_bytes_to_file(&selected_path, &data)?;
    Ok(true)
}

#[tauri::command]
async fn ai_test_connection(
    base_url: String,
    api_key: String,
    requires_api_key: bool,
) -> Result<AiConnectionResult, String> {
    if requires_api_key && api_key.trim().is_empty() {
        return Ok(AiConnectionResult {
            success: false,
            message: "API key is required for this provider.".to_string(),
            models: None,
        });
    }

    let validated_base_url = match validate_ai_base_url(&base_url) {
        Ok(url) => url,
        Err(error) => {
            return Ok(AiConnectionResult {
                success: false,
                message: error,
                models: None,
            })
        }
    };

    let client = ai_http_client(Duration::from_secs(10))?;
    let models_endpoint = build_ai_endpoint(&validated_base_url, "models")?;
    let mut models_request = client
        .get(models_endpoint)
        .header("Content-Type", "application/json");

    if !api_key.trim().is_empty() {
        models_request = models_request.bearer_auth(api_key.trim());
    }

    let response = match models_request.send().await {
        Ok(response) => response,
        Err(error) => {
            return Ok(AiConnectionResult {
                success: false,
                message: map_ai_transport_error(&error, &validated_base_url),
                models: None,
            })
        }
    };

    if response.status().is_success() {
        let data: serde_json::Value = response
            .json()
            .await
            .unwrap_or_else(|_| serde_json::json!({}));
        let models = data
            .get("data")
            .and_then(|value| value.as_array())
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|entry| entry.get("id").and_then(|id| id.as_str()))
                    .map(|id| id.to_string())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        let message = format!(
            "Connected successfully. {} model{} available.",
            models.len(),
            if models.len() == 1 { "" } else { "s" }
        );

        return Ok(AiConnectionResult {
            success: true,
            message,
            models: Some(models),
        });
    }

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Ok(AiConnectionResult {
            success: false,
            message: "Authentication failed. Check your API key.".to_string(),
            models: None,
        });
    }

    if response.status() == reqwest::StatusCode::NOT_FOUND {
        let fallback_body = serde_json::json!({
            "model": "gpt-4o",
            "messages": [{ "role": "user", "content": "Hi" }],
            "max_tokens": 1,
        });
        let fallback = post_ai_chat_completion(
            &validated_base_url,
            api_key.trim(),
            &fallback_body,
            &AiRetryConfig::default(),
        )
        .await;

        return Ok(match fallback {
            Ok(_) => AiConnectionResult {
                success: true,
                message: "Connected successfully.".to_string(),
                models: None,
            },
            Err(error) => AiConnectionResult {
                success: false,
                message: error,
                models: None,
            },
        });
    }

    Ok(AiConnectionResult {
        success: false,
        message: format!(
            "Server returned {}: {}",
            response.status().as_u16(),
            response.status().canonical_reason().unwrap_or("Unknown")
        ),
        models: None,
    })
}

#[tauri::command]
async fn ai_fetch_models(
    base_url: String,
    api_key: String,
    requires_api_key: bool,
) -> Result<Vec<String>, String> {
    if requires_api_key && api_key.trim().is_empty() {
        return Ok(Vec::new());
    }

    let validated_base_url = validate_ai_base_url(&base_url)?;
    let endpoint = build_ai_endpoint(&validated_base_url, "models")?;
    let client = ai_http_client(Duration::from_secs(10))?;
    let mut request = client
        .get(endpoint)
        .header("Content-Type", "application/json");

    if !api_key.trim().is_empty() {
        request = request.bearer_auth(api_key.trim());
    }

    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => return Ok(Vec::new()),
    };

    if !response.status().is_success() {
        return Ok(Vec::new());
    }

    let data: serde_json::Value = response
        .json()
        .await
        .unwrap_or_else(|_| serde_json::json!({}));
    let models = data
        .get("data")
        .and_then(|value| value.as_array())
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry.get("id").and_then(|id| id.as_str()))
                .map(|id| id.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    Ok(models)
}

#[tauri::command]
async fn ai_chat_completion(
    base_url: String,
    api_key: String,
    body: serde_json::Value,
    retry_config: Option<AiRetryConfig>,
) -> Result<String, String> {
    let validated_base_url = validate_ai_base_url(&base_url)?;
    let retry_config = retry_config.unwrap_or_default();
    post_ai_chat_completion(&validated_base_url, api_key.trim(), &body, &retry_config).await
}

#[tauri::command]
fn register_asset_scope(
    app: AppHandle,
    path: String,
    db: State<'_, DatabaseState>,
) -> Result<(), String> {
    let path = PathBuf::from(&path);

    if path.as_os_str().is_empty() {
        return Ok(());
    }

    drop(safe_db_lock(&db)?);
    let validated_path = normalize_directory_path(&path)?;

    // Ensure directory exists
    if !validated_path.exists() {
        std::fs::create_dir_all(&validated_path)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Add the directory and all subdirectories to the asset protocol scope
    app.asset_protocol_scope()
        .allow_directory(&validated_path, true)
        .map_err(|e| format!("Failed to register asset scope: {}", e))
}

#[tauri::command]
fn save_cropped_image(
    path: String,
    base64_data: String,
    db: State<'_, DatabaseState>,
) -> Result<String, String> {
    let path_buf = PathBuf::from(&path);
    drop(safe_db_lock(&db)?);
    let validated_path = normalize_file_path(&path_buf)?;

    // Decode base64 to bytes
    let image_data = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    if let Some(parent) = validated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent directory: {}", e))?;
    }

    // Write to file
    let mut file = std::fs::File::create(&validated_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&image_data)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(validated_path.to_string_lossy().to_string())
}

/// Copy a screenshot from temp location to permanent storage immediately.
/// Used when recording additional steps for an existing recording so images display immediately.
#[tauri::command]
fn copy_screenshot_to_permanent(
    db: State<'_, DatabaseState>,
    temp_path: String,
    recording_id: String,
    recording_name: String,
    custom_screenshot_path: Option<String>,
) -> Result<String, String> {
    use uuid::Uuid;

    let temp_path_buf = PathBuf::from(&temp_path);
    if !temp_path_buf.exists() {
        return Err(format!("Temp screenshot not found: {}", temp_path));
    }

    // Get the base directory (custom path or default)
    let base_dir = match normalize_optional_directory_path(custom_screenshot_path)? {
        Some(path) => path,
        None => safe_db_lock(&db)?.screenshots_dir(),
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
fn update_step_screenshot(
    db: State<'_, DatabaseState>,
    step_id: String,
    screenshot_path: String,
    is_cropped: bool,
) -> Result<(), String> {
    safe_db_lock(&db)?
        .update_step_screenshot(&step_id, &screenshot_path, is_cropped)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reorder_steps(
    db: State<'_, DatabaseState>,
    recording_id: String,
    step_ids: Vec<String>,
) -> Result<(), String> {
    safe_db_lock(&db)?
        .reorder_steps(&recording_id, step_ids)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_step_description(
    db: State<'_, DatabaseState>,
    step_id: String,
    description: String,
) -> Result<(), String> {
    safe_db_lock(&db)?
        .update_step_description(&step_id, &description)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_step(db: State<'_, DatabaseState>, step_id: String) -> Result<(), String> {
    safe_db_lock(&db)?
        .delete_step(&step_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_steps_with_path(
    db: State<'_, DatabaseState>,
    recording_id: String,
    recording_name: String,
    steps: Vec<StepInput>,
    screenshot_path: Option<String>,
) -> Result<(), String> {
    let normalized_screenshot_path =
        normalize_optional_directory_path(screenshot_path)?.map(|path| {
            path.to_string_lossy().to_string()
        });

    safe_db_lock(&db)?
        .save_steps_with_path(
            &recording_id,
            &recording_name,
            steps,
            normalized_screenshot_path.as_deref(),
        )
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
            name: mon
                .name()
                .unwrap_or_else(|_| format!("Monitor {}", index + 1)),
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
    if title.contains("StepSnap")
        || title.contains("Select Capture")
        || title.contains("monitor-picker")
    {
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
            "Item-0", // Menu bar items
            "Notification Center",
            "Focus", // Focus mode overlay
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
        let system_titles = ["Desktop", "gnome-shell", "mutter", "plasmashell", "kwin"];
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
    let target = windows
        .iter()
        .find(|w| w.id().ok().unwrap_or(0) == window_id)
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
async fn save_and_emit_capture(
    app: AppHandle,
    image: image::RgbaImage,
    prefix: &str,
) -> Result<String, String> {
    use image::codecs::jpeg::JpegEncoder;
    use std::io::BufWriter;
    use tokio::time::{sleep, Duration};

    let temp_dir = std::env::temp_dir().join("stepsnap_screenshots");
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

    let _ = app.emit(
        "manual-capture-complete",
        file_path.to_string_lossy().to_string(),
    );

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
        let window_list =
            CGWindowListCopyWindowInfo(K_CG_WINDOW_LIST_OPTION_INCLUDING_WINDOW, window_id);

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
    let script = format!(
        r#"
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
    "#,
        app_name, app_name
    );

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

/// Safe wrapper for database mutex lock that handles poisoned mutexes.
/// A poisoned mutex means a previous operation panicked, but the data may still be valid.
/// We recover by taking the inner value and continuing.
fn safe_db_lock(db: &DatabaseState) -> Result<std::sync::MutexGuard<'_, Database>, String> {
    match db.0.lock() {
        Ok(guard) => Ok(guard),
        Err(poisoned) => {
            eprintln!("Database mutex poisoned, recovering");
            Ok(poisoned.into_inner())
        }
    }
}

#[tauri::command]
async fn capture_window_and_close_picker(
    app: AppHandle,
    state: State<'_, RecordingState>,
    window_id: u32,
    is_minimized: bool,
) -> Result<String, String> {
    use tokio::time::{sleep, Duration};
    use xcap::Window;

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
        use windows::Win32::UI::WindowsAndMessaging::{
            SetForegroundWindow, ShowWindow, SW_RESTORE,
        };

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
    let target = windows
        .into_iter()
        .find(|w| w.id().ok().unwrap_or(0) == window_id)
        .ok_or("Window not found")?;

    // Validate window has valid dimensions before capture
    let target_width = target.width().unwrap_or(0);
    let target_height = target.height().unwrap_or(0);
    if target_width == 0 || target_height == 0 {
        return Err("Window has invalid dimensions".to_string());
    }

    // Safely attempt capture with panic recovery
    let capture_result = catch_unwind(AssertUnwindSafe(|| target.capture_image()));

    let image = match capture_result {
        Ok(Ok(img)) => img,
        Ok(Err(e)) => return Err(format!("Capture failed: {}", e)),
        Err(_) => return Err("Window capture crashed - window may be invalid".to_string()),
    };

    save_and_emit_capture(app, image, "window").await
}

#[tauri::command]
async fn capture_monitor(app: AppHandle, index: usize) -> Result<String, String> {
    use image::codecs::jpeg::JpegEncoder;
    use std::io::BufWriter;
    use xcap::Monitor;

    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let monitor = monitors.get(index).ok_or("Invalid monitor index")?;

    let image = monitor.capture_image().map_err(|e| e.to_string())?;

    // Save to temp file
    let temp_dir = std::env::temp_dir().join("stepsnap_screenshots");
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
    let _ = app.emit(
        "manual-capture-complete",
        file_path.to_string_lossy().to_string(),
    );

    Ok(file_path.to_string_lossy().to_string())
}

/// Combined command that closes picker first, then captures the monitor
/// The picker window is closed (not just hidden) to ensure it's fully removed
/// from the screen before capturing, preventing "ghost window" artifacts
#[tauri::command]
async fn capture_monitor_and_close_picker(
    app: AppHandle,
    state: State<'_, RecordingState>,
    index: usize,
) -> Result<String, String> {
    use image::codecs::jpeg::JpegEncoder;
    use std::io::BufWriter;
    use tokio::time::{sleep, Duration};
    use xcap::Monitor;

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
    let temp_dir = std::env::temp_dir().join("stepsnap_screenshots");
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
    let _ = app.emit(
        "manual-capture-complete",
        file_path.to_string_lossy().to_string(),
    );

    // Show native toast notification (2.5 seconds)
    let _ = overlay::show_toast("Screenshot captured", 2500);

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn capture_all_monitors(app: AppHandle) -> Result<String, String> {
    use image::{codecs::jpeg::JpegEncoder, RgbaImage};
    use std::io::BufWriter;
    use xcap::Monitor;

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
    let temp_dir = std::env::temp_dir().join("stepsnap_screenshots");
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
    encoder
        .encode_image(&rgb_image)
        .map_err(|e| e.to_string())?;

    // Emit capture event
    let _ = app.emit(
        "manual-capture-complete",
        file_path.to_string_lossy().to_string(),
    );

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
async fn show_monitor_picker(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

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
    let _window = WebviewWindowBuilder::new(&app, "monitor-picker", url)
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
async fn close_monitor_picker(
    app: AppHandle,
    state: State<'_, RecordingState>,
) -> Result<(), String> {
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

    println!(
        "Monitor {}: pos=({}, {}), size={}x{}",
        index, x, y, width, height
    );

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
    safe_db_lock(&db)?
        .update_step_ocr(&step_id, ocr_text.as_deref(), &ocr_status)
        .map_err(|e| e.to_string())
}

// ── Notification commands ──────────────────────────────────────────────

#[tauri::command]
fn create_notification(
    db: State<'_, DatabaseState>,
    title: Option<String>,
    message: String,
    variant: String,
) -> Result<Notification, String> {
    safe_db_lock(&db)?
        .create_notification(title.as_deref(), &message, &variant)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn list_notifications(
    db: State<'_, DatabaseState>,
    limit: i32,
    offset: i32,
) -> Result<Vec<Notification>, String> {
    safe_db_lock(&db)?
        .list_notifications(limit, offset)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_unread_notification_count(db: State<'_, DatabaseState>) -> Result<i64, String> {
    safe_db_lock(&db)?
        .get_unread_notification_count()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn mark_notification_read(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    safe_db_lock(&db)?
        .mark_notification_read(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn mark_all_notifications_read(db: State<'_, DatabaseState>) -> Result<(), String> {
    safe_db_lock(&db)?
        .mark_all_notifications_read()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_notification(db: State<'_, DatabaseState>, id: String) -> Result<(), String> {
    safe_db_lock(&db)?
        .delete_notification(&id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_all_notifications(db: State<'_, DatabaseState>) -> Result<(), String> {
    safe_db_lock(&db)?
        .delete_all_notifications()
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
fn update_settings_paths(
    settings_path: &std::path::Path,
    old_identifier: &str,
    new_identifier: &str,
) {
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
        println!(
            "Updated paths in settings.json: {} -> {}",
            old_identifier, new_identifier
        );
    }
}

/// Update paths in the database that reference the old directory.
/// Updates both screenshot_path in steps table AND documentation in recordings table.
fn update_database_paths(db_path: &std::path::Path, old_identifier: &str, new_identifier: &str) {
    use rusqlite::Connection;

    let conn = match Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Warning: Could not open database for path migration: {}", e);
            return;
        }
    };

    // Build LIKE pattern with parameterized query to prevent SQL injection
    let like_pattern = format!("%{}%", old_identifier);

    // Update screenshot_path in steps table using parameterized query
    match conn.execute(
        "UPDATE steps SET screenshot_path = REPLACE(screenshot_path, ?1, ?2) WHERE screenshot_path LIKE ?3",
        rusqlite::params![old_identifier, new_identifier, like_pattern],
    ) {
        Ok(count) => {
            if count > 0 {
                println!("Updated {} screenshot paths in database: {} -> {}", count, old_identifier, new_identifier);
            }
        }
        Err(e) => {
            eprintln!("Warning: Could not update screenshot paths in database: {}", e);
        }
    }

    // Update documentation in recordings table (contains markdown with image paths)
    match conn.execute(
        "UPDATE recordings SET documentation = REPLACE(documentation, ?1, ?2) WHERE documentation LIKE ?3",
        rusqlite::params![old_identifier, new_identifier, like_pattern],
    ) {
        Ok(count) => {
            if count > 0 {
                println!("Updated {} documentation entries in database: {} -> {}", count, old_identifier, new_identifier);
            }
        }
        Err(e) => {
            eprintln!("Warning: Could not update documentation paths in database: {}", e);
        }
    }
}

/// Migrate data from "openscribe" location to new "stepsnap" location.
/// Returns Ok(Some(message)) if user notification is needed, Ok(None) if silent success or nothing to do.
fn migrate_from_openscribe(new_data_dir: &std::path::Path) -> Result<Option<String>, String> {
    // Get parent directory (e.g., %APPDATA% on Windows)
    let parent = match new_data_dir.parent() {
        Some(p) => p,
        None => return Ok(None),
    };

    // Old location with "openscribe" identifier
    let old_data_dir = parent.join("openscribe");

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
            "Data exists in both old (openscribe) and new (stepsnap) locations. You may want to manually check: {}",
            old_data_dir.display()
        )));
    }

    // Attempt to rename old folder to new location
    match std::fs::rename(&old_data_dir, new_data_dir) {
        Ok(_) => {
            println!(
                "Successfully migrated data from {} to {}",
                old_data_dir.display(),
                new_data_dir.display()
            );

            // Rename the database file from openscribe.db to stepsnap.db
            let old_db_in_new_dir = new_data_dir.join("openscribe.db");
            let new_db_path = new_data_dir.join("stepsnap.db");
            if old_db_in_new_dir.exists() {
                if let Err(e) = std::fs::rename(&old_db_in_new_dir, &new_db_path) {
                    eprintln!("Warning: Could not rename database file: {}", e);
                } else {
                    println!("Renamed database: openscribe.db -> stepsnap.db");
                }
            }

            // Update screenshot paths in database that reference the old directory
            // This is critical - screenshot_path values are absolute paths
            update_database_paths(&new_db_path, "openscribe", "stepsnap");

            // Update paths in settings.json that reference the old identifier
            let settings_path = new_data_dir.join("settings.json");
            update_settings_paths(&settings_path, "openscribe", "stepsnap");

            Ok(None) // Silent success
        }
        Err(e) => {
            // Migration failed - notify user
            Ok(Some(format!(
                "Could not migrate data from old location. Your data may be at: {} (Error: {})",
                old_data_dir.display(),
                e
            )))
        }
    }
}

/// Migrate data from old "com.openscribe" identifier location to new "stepsnap" location.
/// This handles very old installations (v0.0.7 and earlier).
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
            println!(
                "Successfully migrated data from {} to {}",
                old_data_dir.display(),
                new_data_dir.display()
            );

            // Rename the database file from openscribe.db to stepsnap.db
            let old_db_in_new_dir = new_data_dir.join("openscribe.db");
            let new_db_path = new_data_dir.join("stepsnap.db");
            if old_db_in_new_dir.exists() {
                if let Err(e) = std::fs::rename(&old_db_in_new_dir, &new_db_path) {
                    eprintln!("Warning: Could not rename database file: {}", e);
                } else {
                    println!("Renamed database: openscribe.db -> stepsnap.db");
                }
            }

            // Update screenshot paths in database that reference the old directory
            // This is critical - screenshot_path values are absolute paths
            update_database_paths(&new_db_path, "com.openscribe", "stepsnap");

            // Update paths in settings.json that reference the old identifier
            let settings_path = new_data_dir.join("settings.json");
            update_settings_paths(&settings_path, "com.openscribe", "stepsnap");

            Ok(None) // Silent success
        }
        Err(e) => {
            // Migration failed - notify user
            Ok(Some(format!(
                "Could not migrate data from old location. Your data may be at: {} (Error: {})",
                old_data_dir.display(),
                e
            )))
        }
    }
}

/// Repair any stale paths that still reference old directory names.
/// This handles the case where migration already happened but paths weren't updated.
/// Fixes both screenshot_path in steps table AND documentation in recordings table.
fn repair_stale_screenshot_paths(app_data_dir: &std::path::Path) {
    use rusqlite::Connection;

    let db_path = app_data_dir.join("stepsnap.db");
    if !db_path.exists() {
        return; // No database to repair
    }

    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => return,
    };

    // Check if any paths still reference old identifiers (in steps or documentation)
    let has_old_paths: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM steps WHERE screenshot_path LIKE '%openscribe%' OR screenshot_path LIKE '%com.openscribe%'
                UNION
                SELECT 1 FROM recordings WHERE documentation LIKE '%openscribe%' OR documentation LIKE '%com.openscribe%'
            )",
            [],
            |row| row.get(0)
        )
        .unwrap_or(false);

    if !has_old_paths {
        return; // Nothing to repair
    }

    println!("Repairing stale paths in database...");

    // Fix screenshot_path in steps table
    // Fix paths that reference 'com.openscribe' (oldest format)
    let _ = conn.execute(
        "UPDATE steps SET screenshot_path = REPLACE(screenshot_path, 'com.openscribe', 'stepsnap') WHERE screenshot_path LIKE '%com.openscribe%'",
        []
    );

    // Fix paths that reference 'openscribe' (previous format)
    let _ = conn.execute(
        "UPDATE steps SET screenshot_path = REPLACE(screenshot_path, 'openscribe', 'stepsnap') WHERE screenshot_path LIKE '%openscribe%'",
        []
    );

    // Fix documentation in recordings table (contains markdown with image paths)
    // Fix paths that reference 'com.openscribe' (oldest format)
    let _ = conn.execute(
        "UPDATE recordings SET documentation = REPLACE(documentation, 'com.openscribe', 'stepsnap') WHERE documentation LIKE '%com.openscribe%'",
        []
    );

    // Fix paths that reference 'openscribe' (previous format)
    let _ = conn.execute(
        "UPDATE recordings SET documentation = REPLACE(documentation, 'openscribe', 'stepsnap') WHERE documentation LIKE '%openscribe%'",
        []
    );

    println!("Path repair complete");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize DPI awareness BEFORE any window/monitor operations (Windows only)
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::HiDpi::{
            SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
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
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(recording_state)
        .setup(move |app| {
            // Initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            // Migration chain: try openscribe -> stepsnap first, then com.openscribe -> stepsnap
            // This handles both v0.0.8-v0.0.10 users (openscribe) and v0.0.7 and earlier (com.openscribe)
            let migration_result = migrate_from_openscribe(&app_data_dir)
                .or_else(|_| migrate_from_old_identifier(&app_data_dir));

            // Repair any stale screenshot paths that weren't updated during migration
            // This handles users who already migrated but have old paths in their database
            repair_stale_screenshot_paths(&app_data_dir);

            if let Ok(Some(warning_message)) = migration_result {
                // Emit warning to frontend - user may need to take action
                let app_handle = app.handle().clone();
                let msg = warning_message.clone();
                std::thread::spawn(move || {
                    // Small delay to ensure frontend is ready
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    let _ = app_handle.emit("migration-warning", msg);
                });
            }

            let db = Database::new(app_data_dir).expect("Failed to initialize database");
            app.manage(DatabaseState(Mutex::new(db)));

            // Start the global input listener in a background thread (for recording)
            recorder::start_listener(
                app.handle().clone(),
                is_recording_clone,
                is_picker_open_clone,
                ocr_enabled_clone,
            );

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
            read_file_base64,
            read_file_bytes,
            save_file_via_dialog,
            ai_test_connection,
            ai_fetch_models,
            ai_chat_completion,
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
            // Notification commands
            create_notification,
            list_notifications,
            get_unread_notification_count,
            mark_notification_read,
            mark_all_notifications_read,
            delete_notification,
            clear_all_notifications,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use rusqlite::{params, Connection};
    use std::fs;
    use std::path::{Path, PathBuf};
    use uuid::Uuid;

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("stepsnap_test_{}", Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn init_db(test_dir: &TestDir) -> PathBuf {
        let _db = Database::new(test_dir.path().to_path_buf()).unwrap();
        test_dir.path().join("stepsnap.db")
    }

    #[test]
    fn normalize_file_path_accepts_existing_absolute_path() {
        let test_dir = TestDir::new();
        let file_path = test_dir.path().join("example.txt");
        fs::write(&file_path, "hello").unwrap();

        let normalized = normalize_file_path(&file_path).unwrap();

        assert_eq!(normalized, file_path.canonicalize().unwrap());
    }

    #[test]
    fn normalize_file_path_accepts_missing_file_under_existing_parent() {
        let test_dir = TestDir::new();
        let file_path = test_dir.path().join("new-file.txt");

        let normalized = normalize_file_path(&file_path).unwrap();
        let expected = test_dir.path().canonicalize().unwrap().join("new-file.txt");

        assert_eq!(normalized, expected);
    }

    #[test]
    fn normalize_file_path_rejects_relative_paths() {
        let error = normalize_file_path(Path::new("relative/file.txt")).unwrap_err();

        assert!(error.contains("absolute"));
    }

    #[test]
    fn normalize_directory_path_accepts_missing_directory_under_existing_parent() {
        let test_dir = TestDir::new();
        let directory_path = test_dir.path().join("screenshots");

        let normalized = normalize_directory_path(&directory_path).unwrap();
        let expected = test_dir.path().canonicalize().unwrap().join("screenshots");

        assert_eq!(normalized, expected);
    }

    #[test]
    fn read_validated_file_bytes_reads_existing_file() {
        let test_dir = TestDir::new();
        let file_path = test_dir.path().join("example.bin");
        fs::write(&file_path, [1_u8, 2, 3, 4]).unwrap();

        let bytes = read_validated_file_bytes(&file_path).unwrap();

        assert_eq!(bytes, vec![1_u8, 2, 3, 4]);
    }

    #[test]
    fn read_file_base64_encodes_existing_file_contents() {
        let test_dir = TestDir::new();
        let file_path = test_dir.path().join("example.txt");
        fs::write(&file_path, "hello").unwrap();

        let encoded = read_file_base64(file_path.to_string_lossy().to_string()).unwrap();

        assert_eq!(encoded, general_purpose::STANDARD.encode("hello"));
    }

    #[test]
    fn write_bytes_to_file_creates_and_writes_file() {
        let test_dir = TestDir::new();
        let file_path = test_dir.path().join("output.txt");

        write_bytes_to_file(&file_path, b"exported").unwrap();

        assert_eq!(fs::read(&file_path).unwrap(), b"exported");
    }

    #[test]
    fn validate_ai_base_url_allows_https_hosts() {
        let url = validate_ai_base_url("https://api.example.com/v1").unwrap();

        assert_eq!(url.as_str(), "https://api.example.com/v1");
    }

    #[test]
    fn validate_ai_base_url_allows_private_http_hosts() {
        let url = validate_ai_base_url("http://192.168.1.10:11434/v1").unwrap();

        assert_eq!(url.as_str(), "http://192.168.1.10:11434/v1");
    }

    #[test]
    fn validate_ai_base_url_rejects_public_http_hosts() {
        let error = validate_ai_base_url("http://example.com/v1").unwrap_err();

        assert!(error.contains("Plain HTTP"));
    }

    #[test]
    fn update_settings_paths_rewrites_old_identifiers() {
        let test_dir = TestDir::new();
        let settings_path = test_dir.path().join("settings.json");
        fs::write(
            &settings_path,
            r#"{"screenshotPath":"C:\\Users\\me\\AppData\\Roaming\\openscribe\\screenshots"}"#,
        )
        .unwrap();

        update_settings_paths(&settings_path, "openscribe", "stepsnap");

        let updated = fs::read_to_string(&settings_path).unwrap();
        assert!(updated.contains("stepsnap"));
        assert!(!updated.contains("openscribe"));
    }

    #[test]
    fn update_database_paths_rewrites_step_and_documentation_paths() {
        let test_dir = TestDir::new();
        let db_path = init_db(&test_dir);
        let conn = Connection::open(&db_path).unwrap();

        conn.execute(
            "INSERT INTO recordings (id, name, created_at, updated_at, documentation) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["rec-1", "Recording", 1_i64, 1_i64, "![img](C:/data/openscribe/example.png)"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO steps (id, recording_id, type_, timestamp, screenshot_path, order_index, is_cropped) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["step-1", "rec-1", "capture", 1_i64, "C:/data/openscribe/example.png", 0_i32, 0_i32],
        )
        .unwrap();

        update_database_paths(&db_path, "openscribe", "stepsnap");

        let step_path: String = conn
            .query_row(
                "SELECT screenshot_path FROM steps WHERE id = ?1",
                params!["step-1"],
                |row| row.get(0),
            )
            .unwrap();
        let documentation: String = conn
            .query_row(
                "SELECT documentation FROM recordings WHERE id = ?1",
                params!["rec-1"],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(step_path, "C:/data/stepsnap/example.png");
        assert!(documentation.contains("stepsnap"));
        assert!(!documentation.contains("openscribe"));
    }

    #[test]
    fn repair_stale_screenshot_paths_updates_all_legacy_identifiers() {
        let test_dir = TestDir::new();
        let db_path = init_db(&test_dir);
        let conn = Connection::open(&db_path).unwrap();

        conn.execute(
            "INSERT INTO recordings (id, name, created_at, updated_at, documentation) VALUES (?1, ?2, ?3, ?4, ?5)",
            params!["rec-1", "Recording", 1_i64, 1_i64, "![old](C:/data/com.openscribe/a.png)\n![older](C:/data/openscribe/b.png)"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO steps (id, recording_id, type_, timestamp, screenshot_path, order_index, is_cropped) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["step-1", "rec-1", "capture", 1_i64, "C:/data/com.openscribe/a.png", 0_i32, 0_i32],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO steps (id, recording_id, type_, timestamp, screenshot_path, order_index, is_cropped) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params!["step-2", "rec-1", "capture", 2_i64, "C:/data/openscribe/b.png", 1_i32, 0_i32],
        )
        .unwrap();

        repair_stale_screenshot_paths(test_dir.path());

        let step_paths: Vec<String> = conn
            .prepare("SELECT screenshot_path FROM steps ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(|row| row.unwrap())
            .collect();
        let documentation: String = conn
            .query_row(
                "SELECT documentation FROM recordings WHERE id = ?1",
                params!["rec-1"],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(
            step_paths,
            vec![
                "C:/data/stepsnap/a.png".to_string(),
                "C:/data/stepsnap/b.png".to_string(),
            ]
        );
        assert!(documentation.contains("stepsnap/a.png"));
        assert!(documentation.contains("stepsnap/b.png"));
        assert!(!documentation.contains("openscribe"));
    }
}
