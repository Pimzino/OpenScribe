use rusqlite::{Connection, params, Result, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct DeleteRecordingCleanup {
    pub files: Vec<PathBuf>,
    pub dirs: Vec<PathBuf>,
    /// Directory that must never be removed (even if empty).
    pub protected_dir: PathBuf,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Recording {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub documentation: Option<String>,
    pub documentation_generated_at: Option<i64>,
    pub step_count: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Step {
    pub id: String,
    pub recording_id: String,
    pub type_: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub text: Option<String>,
    pub timestamp: i64,
    pub screenshot_path: Option<String>,
    pub element_name: Option<String>,
    pub element_type: Option<String>,
    pub element_value: Option<String>,
    pub app_name: Option<String>,
    pub order_index: i32,
    pub description: Option<String>,
    pub is_cropped: Option<bool>,
    pub ocr_text: Option<String>,
    pub ocr_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct StepInput {
    pub type_: String,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub text: Option<String>,
    pub timestamp: i64,
    pub screenshot: Option<String>,
    pub element_name: Option<String>,
    pub element_type: Option<String>,
    pub element_value: Option<String>,
    pub app_name: Option<String>,
    pub description: Option<String>,
    pub is_cropped: Option<bool>,
    pub order_index: Option<i32>,
    /// If true, the screenshot path is already in permanent storage (no copy needed)
    pub screenshot_is_permanent: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingWithSteps {
    pub recording: Recording,
    pub steps: Vec<Step>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedRecordings {
    pub recordings: Vec<Recording>,
    pub total_count: i64,
    pub page: i32,
    pub per_page: i32,
    pub total_pages: i32,
}

pub struct Database {
    conn: Connection,
    data_dir: PathBuf,
}

impl Database {
    pub fn new(app_data_dir: PathBuf) -> Result<Self> {
        // Ensure directory exists
        fs::create_dir_all(&app_data_dir).map_err(|e| {
            rusqlite::Error::InvalidPath(app_data_dir.join(e.to_string()))
        })?;

        let db_path = app_data_dir.join("openscribe.db");
        let conn = Connection::open(&db_path)?;

        let db = Database {
            conn,
            data_dir: app_data_dir,
        };

        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<()> {
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS recordings (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                documentation TEXT
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS steps (
                id TEXT PRIMARY KEY,
                recording_id TEXT NOT NULL,
                type_ TEXT NOT NULL,
                x INTEGER,
                y INTEGER,
                text TEXT,
                timestamp INTEGER NOT NULL,
                screenshot_path TEXT,
                element_name TEXT,
                element_type TEXT,
                element_value TEXT,
                app_name TEXT,
                order_index INTEGER NOT NULL,
                FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
            )",
            [],
        )?;

        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_steps_recording_id ON steps(recording_id)",
            [],
        )?;

        // Migration: Add description column if it doesn't exist
        let has_description: bool = self.conn
            .prepare("SELECT description FROM steps LIMIT 1")
            .is_ok();

        if !has_description {
            self.conn.execute(
                "ALTER TABLE steps ADD COLUMN description TEXT",
                [],
            )?;
        }

        // Migration: Add is_cropped column if it doesn't exist
        let has_is_cropped: bool = self.conn
            .prepare("SELECT is_cropped FROM steps LIMIT 1")
            .is_ok();

        if !has_is_cropped {
            self.conn.execute(
                "ALTER TABLE steps ADD COLUMN is_cropped INTEGER DEFAULT 0",
                [],
            )?;
        }

        // Migration: Add ocr_text column if it doesn't exist
        let has_ocr_text: bool = self.conn
            .prepare("SELECT ocr_text FROM steps LIMIT 1")
            .is_ok();

        if !has_ocr_text {
            self.conn.execute(
                "ALTER TABLE steps ADD COLUMN ocr_text TEXT",
                [],
            )?;
        }

        // Migration: Add ocr_status column if it doesn't exist
        let has_ocr_status: bool = self.conn
            .prepare("SELECT ocr_status FROM steps LIMIT 1")
            .is_ok();

        if !has_ocr_status {
            self.conn.execute(
                "ALTER TABLE steps ADD COLUMN ocr_status TEXT DEFAULT 'pending'",
                [],
            )?;
        }

        // Migration: Add documentation_generated_at column to recordings if it doesn't exist
        let has_doc_generated_at: bool = self.conn
            .prepare("SELECT documentation_generated_at FROM recordings LIMIT 1")
            .is_ok();

        if !has_doc_generated_at {
            self.conn.execute(
                "ALTER TABLE recordings ADD COLUMN documentation_generated_at INTEGER",
                [],
            )?;
        }

        // Backfill: For existing recordings with documentation but no documentation_generated_at,
        // set it to updated_at (assumes docs were in sync at last update)
        self.conn.execute(
            "UPDATE recordings SET documentation_generated_at = updated_at
             WHERE documentation IS NOT NULL AND documentation_generated_at IS NULL",
            [],
        )?;

        Ok(())
    }

    pub fn screenshots_dir(&self) -> PathBuf {
        let dir = self.data_dir.join("screenshots");
        let _ = fs::create_dir_all(&dir);
        dir
    }

    pub fn get_default_screenshot_path(&self) -> PathBuf {
        self.data_dir.join("screenshots")
    }

    /// Sanitize a string to be safe for use as a directory name (public version)
    pub fn sanitize_dirname_public(name: &str) -> String {
        Self::sanitize_dirname(name)
    }

    /// Sanitize a string to be safe for use as a directory name
    fn sanitize_dirname(name: &str) -> String {
        // Characters invalid on Windows
        let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

        // Windows reserved names
        let reserved_names = [
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
        ];

        let mut sanitized: String = name
            .chars()
            .map(|c| {
                if invalid_chars.contains(&c) || c.is_control() || c == ' ' {
                    '_'
                } else {
                    c
                }
            })
            .collect();

        // Collapse multiple underscores
        while sanitized.contains("__") {
            sanitized = sanitized.replace("__", "_");
        }

        // Trim leading/trailing dots and spaces
        sanitized = sanitized.trim_matches(|c| c == '.' || c == ' ').to_string();

        // Check for reserved names
        let upper = sanitized.to_uppercase();
        let base_name = upper.split('.').next().unwrap_or("");
        if reserved_names.contains(&base_name) {
            sanitized = format!("_{}", sanitized);
        }

        // Truncate to 255 characters
        if sanitized.len() > 255 {
            sanitized.truncate(255);
            sanitized = sanitized.trim_end_matches(|c| c == '.' || c == ' ').to_string();
        }

        // Fallback if empty
        if sanitized.is_empty() {
            sanitized = "untitled".to_string();
        }

        sanitized
    }

    pub fn create_recording(&self, name: String) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().timestamp_millis();

        self.conn.execute(
            "INSERT INTO recordings (id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, now, now],
        )?;

        Ok(id)
    }

    pub fn save_steps(&self, recording_id: &str, steps: Vec<StepInput>) -> Result<()> {
        let screenshots_dir = self.screenshots_dir();

        for (index, step) in steps.into_iter().enumerate() {
            let step_id = Uuid::new_v4().to_string();

            // Copy screenshot to persistent storage if exists
            let persistent_screenshot = if let Some(temp_path) = &step.screenshot {
                let temp_path = PathBuf::from(temp_path);
                if temp_path.exists() {
                    let filename = format!("{}_{}.jpg", recording_id, step_id);
                    let dest_path = screenshots_dir.join(&filename);
                    if fs::copy(&temp_path, &dest_path).is_ok() {
                        // Delete temp file after successful copy
                        let _ = fs::remove_file(&temp_path);
                        Some(dest_path.to_string_lossy().to_string())
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            self.conn.execute(
                "INSERT INTO steps (id, recording_id, type_, x, y, text, timestamp, screenshot_path, element_name, element_type, element_value, app_name, order_index, description, is_cropped)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    step_id,
                    recording_id,
                    step.type_,
                    step.x,
                    step.y,
                    step.text,
                    step.timestamp,
                    persistent_screenshot,
                    step.element_name,
                    step.element_type,
                    step.element_value,
                    step.app_name,
                    index as i32,
                    step.description,
                    step.is_cropped.unwrap_or(false) as i32
                ],
            )?;
        }

        // Update recording timestamp
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE recordings SET updated_at = ?1 WHERE id = ?2",
            params![now, recording_id],
        )?;

        Ok(())
    }

    pub fn save_steps_with_path(
        &self,
        recording_id: &str,
        recording_name: &str,
        steps: Vec<StepInput>,
        custom_screenshot_path: Option<&str>
    ) -> Result<()> {
        // Determine base screenshots directory
        let base_dir = match custom_screenshot_path {
            Some(path) if !path.is_empty() => PathBuf::from(path),
            _ => self.screenshots_dir(),
        };

        // Create recording-specific subfolder with sanitized name
        let sanitized_name = Self::sanitize_dirname(recording_name);
        let screenshots_dir = base_dir.join(&sanitized_name);
        let _ = fs::create_dir_all(&screenshots_dir);

        for (index, step) in steps.into_iter().enumerate() {
            let step_id = Uuid::new_v4().to_string();

            // Handle screenshot: either use existing permanent path or copy from temp
            let persistent_screenshot = if step.screenshot_is_permanent.unwrap_or(false) {
                // Screenshot is already in permanent storage, use it directly
                step.screenshot.clone()
            } else if let Some(temp_path) = &step.screenshot {
                // Copy screenshot from temp to persistent storage
                let temp_path = PathBuf::from(temp_path);
                if temp_path.exists() {
                    let filename = format!("{}_{}.jpg", recording_id, step_id);
                    let dest_path = screenshots_dir.join(&filename);
                    if fs::copy(&temp_path, &dest_path).is_ok() {
                        // Delete temp file after successful copy
                        let _ = fs::remove_file(&temp_path);
                        Some(dest_path.to_string_lossy().to_string())
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            // Use provided order_index if available, otherwise use enumeration index
            let final_order_index = step.order_index.unwrap_or(index as i32);

            self.conn.execute(
                "INSERT INTO steps (id, recording_id, type_, x, y, text, timestamp, screenshot_path, element_name, element_type, element_value, app_name, order_index, description, is_cropped)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
                params![
                    step_id,
                    recording_id,
                    step.type_,
                    step.x,
                    step.y,
                    step.text,
                    step.timestamp,
                    persistent_screenshot,
                    step.element_name,
                    step.element_type,
                    step.element_value,
                    step.app_name,
                    final_order_index,
                    step.description,
                    step.is_cropped.unwrap_or(false) as i32
                ],
            )?;
        }

        // Update recording timestamp
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE recordings SET updated_at = ?1 WHERE id = ?2",
            params![now, recording_id],
        )?;

        Ok(())
    }

    pub fn save_documentation(&self, recording_id: &str, documentation: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE recordings SET documentation = ?1, updated_at = ?2, documentation_generated_at = ?3 WHERE id = ?4",
            params![documentation, now, now, recording_id],
        )?;
        Ok(())
    }

    pub fn list_recordings(&self) -> Result<Vec<Recording>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.name, r.created_at, r.updated_at, r.documentation, r.documentation_generated_at,
                    (SELECT COUNT(*) FROM steps WHERE recording_id = r.id) as step_count
             FROM recordings r
             ORDER BY r.updated_at DESC"
        )?;

        let recordings = stmt.query_map([], |row| {
            Ok(Recording {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                documentation: row.get(4)?,
                documentation_generated_at: row.get(5)?,
                step_count: row.get(6)?,
            })
        })?;

        recordings.collect()
    }

    pub fn list_recordings_paginated(&self, page: i32, per_page: i32, search: Option<&str>) -> Result<PaginatedRecordings> {
        let offset = (page - 1) * per_page;
        
        // Build the WHERE clause for search
        let search_clause = if search.is_some() {
            "WHERE r.name LIKE ?1"
        } else {
            ""
        };
        
        // Get total count
        let count_sql = format!(
            "SELECT COUNT(*) FROM recordings r {}",
            search_clause
        );
        
        let total_count: i64 = if let Some(ref search_term) = search {
            let search_pattern = format!("%{}%", search_term);
            self.conn.query_row(&count_sql, params![search_pattern], |row| row.get(0))?
        } else {
            self.conn.query_row(&count_sql, [], |row| row.get(0))?
        };
        
        // Calculate total pages
        let total_pages = ((total_count as f64) / (per_page as f64)).ceil() as i32;
        
        // Get paginated recordings
        let query_sql = format!(
            "SELECT r.id, r.name, r.created_at, r.updated_at, r.documentation, r.documentation_generated_at,
                    (SELECT COUNT(*) FROM steps WHERE recording_id = r.id) as step_count
             FROM recordings r
             {}
             ORDER BY r.updated_at DESC
             LIMIT ?{} OFFSET ?{}",
            search_clause,
            if search.is_some() { "2" } else { "1" },
            if search.is_some() { "3" } else { "2" }
        );
        
        let recordings: Vec<Recording> = if let Some(ref search_term) = search {
            let search_pattern = format!("%{}%", search_term);
            let mut stmt = self.conn.prepare(&query_sql)?;
            let rows = stmt.query_map(params![search_pattern, per_page, offset], |row| {
                Ok(Recording {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    documentation: row.get(4)?,
                    documentation_generated_at: row.get(5)?,
                    step_count: row.get(6)?,
                })
            })?;
            rows.collect::<Result<Vec<_>>>()?
        } else {
            let mut stmt = self.conn.prepare(&query_sql)?;
            let rows = stmt.query_map(params![per_page, offset], |row| {
                Ok(Recording {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    updated_at: row.get(3)?,
                    documentation: row.get(4)?,
                    documentation_generated_at: row.get(5)?,
                    step_count: row.get(6)?,
                })
            })?;
            rows.collect::<Result<Vec<_>>>()?
        };
        
        Ok(PaginatedRecordings {
            recordings,
            total_count,
            page,
            per_page,
            total_pages,
        })
    }

    pub fn get_recording(&self, id: &str) -> Result<Option<RecordingWithSteps>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.name, r.created_at, r.updated_at, r.documentation, r.documentation_generated_at,
                    (SELECT COUNT(*) FROM steps WHERE recording_id = r.id) as step_count
             FROM recordings r WHERE r.id = ?1"
        )?;

        let recording: Option<Recording> = stmt.query_row(params![id], |row| {
            Ok(Recording {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                documentation: row.get(4)?,
                documentation_generated_at: row.get(5)?,
                step_count: row.get(6)?,
            })
        }).optional()?;

        match recording {
            Some(rec) => {
                let mut stmt = self.conn.prepare(
                    "SELECT id, recording_id, type_, x, y, text, timestamp, screenshot_path,
                            element_name, element_type, element_value, app_name, order_index, description, is_cropped,
                            ocr_text, ocr_status
                     FROM steps WHERE recording_id = ?1 ORDER BY order_index"
                )?;

                let steps = stmt.query_map(params![id], |row| {
                    Ok(Step {
                        id: row.get(0)?,
                        recording_id: row.get(1)?,
                        type_: row.get(2)?,
                        x: row.get(3)?,
                        y: row.get(4)?,
                        text: row.get(5)?,
                        timestamp: row.get(6)?,
                        screenshot_path: row.get(7)?,
                        element_name: row.get(8)?,
                        element_type: row.get(9)?,
                        element_value: row.get(10)?,
                        app_name: row.get(11)?,
                        order_index: row.get(12)?,
                        description: row.get(13)?,
                        is_cropped: row.get::<_, Option<i32>>(14)?.map(|v| v != 0),
                        ocr_text: row.get(15)?,
                        ocr_status: row.get(16)?,
                    })
                })?.collect::<Result<Vec<_>>>()?;

                Ok(Some(RecordingWithSteps {
                    recording: rec,
                    steps,
                }))
            }
            None => Ok(None),
        }
    }

    pub fn delete_recording(&self, id: &str) -> Result<DeleteRecordingCleanup> {
        // Collect screenshot paths from steps. Filesystem cleanup is intentionally not
        // performed here because callers typically hold a mutex lock while calling.
        let mut stmt = self.conn.prepare(
            "SELECT screenshot_path FROM steps WHERE recording_id = ?1 AND screenshot_path IS NOT NULL"
        )?;

        let screenshot_paths: Vec<String> = stmt
            .query_map(params![id], |row| row.get(0))?
            .filter_map(|r| r.ok())
            .collect();

        let mut files: Vec<PathBuf> = Vec::new();
        let mut dirs: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();

        for path in screenshot_paths {
            let path_buf = PathBuf::from(&path);
            if let Some(parent) = path_buf.parent() {
                dirs.insert(parent.to_path_buf());
            }
            files.push(path_buf);
        }

        // Delete from database.
        self.conn.execute("DELETE FROM steps WHERE recording_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM recordings WHERE id = ?1", params![id])?;

        // Protect the default screenshots directory from deletion, even if it is empty.
        let protected_dir = self.get_default_screenshot_path();
        dirs.remove(&protected_dir);

        Ok(DeleteRecordingCleanup {
            files,
            dirs: dirs.into_iter().collect(),
            protected_dir,
        })
    }

    pub fn update_recording_name(&self, id: &str, name: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE recordings SET name = ?1 WHERE id = ?2",
            params![name, id],
        )?;
        Ok(())
    }

    pub fn update_step_screenshot(&self, step_id: &str, screenshot_path: &str, is_cropped: bool) -> Result<()> {
        self.conn.execute(
            "UPDATE steps SET screenshot_path = ?1, is_cropped = ?2 WHERE id = ?3",
            params![screenshot_path, is_cropped as i32, step_id],
        )?;
        Ok(())
    }

    pub fn reorder_steps(&self, recording_id: &str, step_ids: Vec<String>) -> Result<()> {
        for (index, step_id) in step_ids.into_iter().enumerate() {
            self.conn.execute(
                "UPDATE steps SET order_index = ?1 WHERE id = ?2 AND recording_id = ?3",
                params![index as i32, step_id, recording_id],
            )?;
        }

        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE recordings SET updated_at = ?1 WHERE id = ?2",
            params![now, recording_id],
        )?;

        Ok(())
    }

    pub fn update_step_description(&self, step_id: &str, description: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE steps SET description = ?1 WHERE id = ?2",
            params![description, step_id],
        )?;
        Ok(())
    }

    pub fn delete_step(&self, step_id: &str) -> Result<()> {
        // Get screenshot path before deleting
        let screenshot_path: Option<String> = self.conn
            .query_row(
                "SELECT screenshot_path FROM steps WHERE id = ?1",
                params![step_id],
                |row| row.get(0)
            )
            .optional()?;

        // Delete screenshot file if exists
        if let Some(path) = screenshot_path {
            let _ = fs::remove_file(path);
        }

        // Delete from database
        self.conn.execute(
            "DELETE FROM steps WHERE id = ?1",
            params![step_id],
        )?;

        Ok(())
    }

    pub fn update_step_ocr(&self, step_id: &str, ocr_text: Option<&str>, ocr_status: &str) -> Result<()> {
        self.conn.execute(
            "UPDATE steps SET ocr_text = ?1, ocr_status = ?2 WHERE id = ?3",
            params![ocr_text, ocr_status, step_id],
        )?;
        Ok(())
    }
}
