// Centralized file-based logging for StepSnap.
//
// Logs live under <app_data_dir>/logs and are split into one file per category
// (app, ai, recorder, database, accessibility, ocr, ui). Each file rotates
// daily and is retained for 30 days. The frontend writes to the same files via
// the `log_event` Tauri command, so a user-visible toast can be cross-referenced
// to the exact line on disk.

use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::{Duration as ChronoDuration, Local, NaiveDate};
use serde::Deserialize;
use serde_json::Value;

const RETENTION_DAYS: i64 = 30;

pub const CATEGORY_APP: &str = "app";
pub const CATEGORY_AI: &str = "ai";
pub const CATEGORY_RECORDER: &str = "recorder";
pub const CATEGORY_DATABASE: &str = "database";
#[allow(dead_code)]
pub const CATEGORY_ACCESSIBILITY: &str = "accessibility";
#[allow(dead_code)]
pub const CATEGORY_OCR: &str = "ocr";
pub const CATEGORY_UI: &str = "ui";

const KNOWN_CATEGORIES: &[&str] = &[
    CATEGORY_APP,
    CATEGORY_AI,
    CATEGORY_RECORDER,
    CATEGORY_DATABASE,
    CATEGORY_ACCESSIBILITY,
    CATEGORY_OCR,
    CATEGORY_UI,
];

struct LoggerState {
    logs_dir: PathBuf,
    files: Mutex<HashMap<String, FileSlot>>,
}

struct FileSlot {
    date: NaiveDate,
    file: File,
}

static STATE: OnceLock<LoggerState> = OnceLock::new();

/// Initialise the logger. Called once during Tauri setup.
///
/// `app_data_dir` is the value returned by `app.path().app_data_dir()`. The
/// logs directory is `<app_data_dir>/logs` and is created if missing. Logs
/// older than 30 days are pruned eagerly. Re-initialisation is a no-op so the
/// caller does not need to guard against repeat calls.
pub fn init(app_data_dir: &Path) -> Result<PathBuf, String> {
    if let Some(existing) = STATE.get() {
        return Ok(existing.logs_dir.clone());
    }

    let logs_dir = app_data_dir.join("logs");
    fs::create_dir_all(&logs_dir)
        .map_err(|e| format!("Failed to create logs directory {}: {}", logs_dir.display(), e))?;

    let state = LoggerState {
        logs_dir: logs_dir.clone(),
        files: Mutex::new(HashMap::new()),
    };

    if STATE.set(state).is_err() {
        // Another thread won the race; that's fine.
        return Ok(STATE.get().unwrap().logs_dir.clone());
    }

    // Best-effort retention sweep on startup; failures are logged but not fatal.
    if let Err(err) = prune_old_logs(&logs_dir, RETENTION_DAYS) {
        eprintln!("[logging] Failed to prune old logs: {}", err);
    }

    log(CATEGORY_APP, "info", "Logging system initialised", None);
    Ok(logs_dir)
}

/// Returns the path to the logs directory.
pub fn logs_dir() -> Option<PathBuf> {
    STATE.get().map(|s| s.logs_dir.clone())
}

/// Severity levels accepted by `log` and the `log_event` Tauri command.
/// Anything unrecognised is recorded as INFO.
fn normalise_level(level: &str) -> &'static str {
    match level.to_ascii_lowercase().as_str() {
        "trace" => "TRACE",
        "debug" => "DEBUG",
        "info" => "INFO",
        "warn" | "warning" => "WARN",
        "error" => "ERROR",
        _ => "INFO",
    }
}

fn normalise_category(category: &str) -> String {
    let trimmed = category.trim();
    if trimmed.is_empty() {
        return CATEGORY_APP.to_string();
    }
    // Lock-down: only alphanumeric, dash, underscore. Avoids path-traversal via
    // the frontend.
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        }
    }
    if out.is_empty() {
        CATEGORY_APP.to_string()
    } else {
        out
    }
}

/// Write a single log line to the file for `category`.
///
/// `metadata` is rendered as pretty-printed-on-one-line JSON appended after the
/// message. Failures are swallowed so logging never breaks application logic.
pub fn log(category: &str, level: &str, message: &str, metadata: Option<&Value>) {
    let Some(state) = STATE.get() else {
        // Logger not initialised yet (e.g. very early startup). Fall back to
        // stderr so the message is not lost.
        eprintln!(
            "[{} {}] {} {}",
            category,
            level,
            message,
            metadata.map(|m| m.to_string()).unwrap_or_default()
        );
        return;
    };

    let category = normalise_category(category);
    let level = normalise_level(level);
    let now = Local::now();
    let today = now.date_naive();
    let timestamp = now.format("%Y-%m-%d %H:%M:%S%.3f%z");

    let mut line = format!("[{timestamp}] [{level}] {message}");
    if let Some(meta) = metadata {
        // Single-line JSON so each log line stays grep-friendly.
        if let Ok(rendered) = serde_json::to_string(meta) {
            if rendered != "null" {
                line.push(' ');
                line.push_str(&rendered);
            }
        }
    }
    line.push('\n');

    let mut files = match state.files.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let needs_open = match files.get(&category) {
        Some(slot) => slot.date != today,
        None => true,
    };

    if needs_open {
        let path = log_file_path(&state.logs_dir, &category, today);
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match OpenOptions::new().create(true).append(true).open(&path) {
            Ok(file) => {
                files.insert(category.clone(), FileSlot { date: today, file });
            }
            Err(err) => {
                eprintln!(
                    "[logging] Failed to open {}: {} -- dropping line: {}",
                    path.display(),
                    err,
                    line.trim_end()
                );
                return;
            }
        }
    }

    if let Some(slot) = files.get_mut(&category) {
        if let Err(err) = slot.file.write_all(line.as_bytes()) {
            eprintln!("[logging] Write failed for {}: {}", category, err);
        }
        let _ = slot.file.flush();
    }
}

fn log_file_path(logs_dir: &Path, category: &str, date: NaiveDate) -> PathBuf {
    logs_dir.join(format!("{}.{}.log", category, date.format("%Y-%m-%d")))
}

/// Remove log files older than `retention_days`. Files that do not match the
/// expected `<category>.<YYYY-MM-DD>.log` pattern are left alone.
fn prune_old_logs(logs_dir: &Path, retention_days: i64) -> Result<(), String> {
    let cutoff = Local::now().date_naive() - ChronoDuration::days(retention_days);
    let entries = fs::read_dir(logs_dir)
        .map_err(|e| format!("read_dir {}: {}", logs_dir.display(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".log") else {
            continue;
        };
        // category.YYYY-MM-DD
        let Some((_category, date_str)) = stem.rsplit_once('.') else {
            continue;
        };
        let Ok(file_date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
            continue;
        };
        if file_date < cutoff {
            let _ = fs::remove_file(&path);
        }
    }
    Ok(())
}

/// Trigger a retention sweep on demand. Safe to call at any time.
#[allow(dead_code)]
pub fn enforce_retention() {
    if let Some(state) = STATE.get() {
        let _ = prune_old_logs(&state.logs_dir, RETENTION_DAYS);
    }
}

// -- Tauri commands ---------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEventInput {
    pub category: Option<String>,
    pub level: Option<String>,
    pub message: String,
    pub metadata: Option<Value>,
}

#[tauri::command]
pub fn log_event(payload: LogEventInput) -> Result<(), String> {
    let category = payload.category.as_deref().unwrap_or(CATEGORY_UI);
    let level = payload.level.as_deref().unwrap_or("info");
    log(category, level, &payload.message, payload.metadata.as_ref());
    Ok(())
}

#[tauri::command]
pub fn get_logs_dir() -> Result<String, String> {
    logs_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "Logger not initialised".to_string())
}

/// Ensures the logs directory exists and returns its path. Frontend opens it
/// via `@tauri-apps/plugin-opener`'s `openPath`, which is the same plumbing
/// used elsewhere in the app.
#[tauri::command]
pub fn ensure_logs_dir() -> Result<String, String> {
    let dir = logs_dir().ok_or_else(|| "Logger not initialised".to_string())?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create logs directory: {}", e))?;
    }
    Ok(dir.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn list_log_files() -> Result<Vec<String>, String> {
    let dir = logs_dir().ok_or_else(|| "Logger not initialised".to_string())?;
    let mut names: Vec<String> = fs::read_dir(&dir)
        .map_err(|e| format!("read_dir {}: {}", dir.display(), e))?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.is_file() {
                path.file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect();
    names.sort();
    Ok(names)
}

/// Convenience for code paths that need a stable, well-known category name.
#[allow(dead_code)]
pub fn is_known_category(category: &str) -> bool {
    KNOWN_CATEGORIES.contains(&category)
}

/// Resolve the most useful log path for a notification's "View log" action.
///
/// Preference order:
///   1. Today's file for the requested category, if it exists
///   2. The most recent file for that category (`<category>.<date>.log`)
///   3. The logs directory itself, so the user can browse
///
/// `category` is validated against `KNOWN_CATEGORIES` to keep arbitrary paths
/// out of the call.
#[tauri::command]
pub fn resolve_log_file(category: String) -> Result<String, String> {
    if !is_known_category(&category) {
        return Err(format!("Unknown log category: {}", category));
    }
    let dir = logs_dir().ok_or_else(|| "Logger not initialised".to_string())?;

    let today_path = log_file_path(&dir, &category, Local::now().date_naive());
    if today_path.exists() {
        return Ok(today_path.to_string_lossy().into_owned());
    }

    let prefix = format!("{}.", category);
    let mut newest: Option<(NaiveDate, PathBuf)> = None;
    for entry in fs::read_dir(&dir)
        .map_err(|e| format!("read_dir {}: {}", dir.display(), e))?
        .flatten()
    {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(stem) = name.strip_suffix(".log") else {
            continue;
        };
        let Some(date_str) = stem.strip_prefix(&prefix) else {
            continue;
        };
        let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") else {
            continue;
        };
        if newest.as_ref().map_or(true, |(d, _)| date > *d) {
            newest = Some((date, path));
        }
    }

    if let Some((_, path)) = newest {
        return Ok(path.to_string_lossy().into_owned());
    }

    Ok(dir.to_string_lossy().into_owned())
}
