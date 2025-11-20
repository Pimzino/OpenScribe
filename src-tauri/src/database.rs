use rusqlite::{Connection, params, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::fs;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Recording {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub documentation: Option<String>,
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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RecordingWithSteps {
    pub recording: Recording,
    pub steps: Vec<Step>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Statistics {
    pub total_recordings: i32,
    pub total_steps: i32,
    pub recordings_this_week: i32,
    pub recent_recordings: Vec<Recording>,
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

        Ok(())
    }

    pub fn screenshots_dir(&self) -> PathBuf {
        let dir = self.data_dir.join("screenshots");
        let _ = fs::create_dir_all(&dir);
        dir
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
                "INSERT INTO steps (id, recording_id, type_, x, y, text, timestamp, screenshot_path, element_name, element_type, element_value, app_name, order_index)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
                    index as i32
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
            "UPDATE recordings SET documentation = ?1, updated_at = ?2 WHERE id = ?3",
            params![documentation, now, recording_id],
        )?;
        Ok(())
    }

    pub fn list_recordings(&self) -> Result<Vec<Recording>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.name, r.created_at, r.updated_at, r.documentation,
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
                step_count: row.get(5)?,
            })
        })?;

        recordings.collect()
    }

    pub fn get_recording(&self, id: &str) -> Result<Option<RecordingWithSteps>> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.name, r.created_at, r.updated_at, r.documentation,
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
                step_count: row.get(5)?,
            })
        }).ok();

        match recording {
            Some(rec) => {
                let mut stmt = self.conn.prepare(
                    "SELECT id, recording_id, type_, x, y, text, timestamp, screenshot_path,
                            element_name, element_type, element_value, app_name, order_index
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

    pub fn delete_recording(&self, id: &str) -> Result<()> {
        // Get screenshot paths to delete
        let mut stmt = self.conn.prepare(
            "SELECT screenshot_path FROM steps WHERE recording_id = ?1 AND screenshot_path IS NOT NULL"
        )?;

        let paths: Vec<String> = stmt.query_map(params![id], |row| {
            row.get(0)
        })?.filter_map(|r| r.ok()).collect();

        // Delete screenshot files
        for path in paths {
            let _ = fs::remove_file(path);
        }

        // Delete from database
        self.conn.execute("DELETE FROM steps WHERE recording_id = ?1", params![id])?;
        self.conn.execute("DELETE FROM recordings WHERE id = ?1", params![id])?;

        Ok(())
    }

    pub fn update_recording_name(&self, id: &str, name: &str) -> Result<()> {
        let now = chrono::Utc::now().timestamp_millis();
        self.conn.execute(
            "UPDATE recordings SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![name, now, id],
        )?;
        Ok(())
    }

    pub fn get_statistics(&self) -> Result<Statistics> {
        let total_recordings: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM recordings",
            [],
            |row| row.get(0),
        )?;

        let total_steps: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM steps",
            [],
            |row| row.get(0),
        )?;

        let week_ago = chrono::Utc::now().timestamp_millis() - (7 * 24 * 60 * 60 * 1000);
        let recordings_this_week: i32 = self.conn.query_row(
            "SELECT COUNT(*) FROM recordings WHERE created_at >= ?1",
            params![week_ago],
            |row| row.get(0),
        )?;

        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.name, r.created_at, r.updated_at, r.documentation,
                    (SELECT COUNT(*) FROM steps WHERE recording_id = r.id) as step_count
             FROM recordings r
             ORDER BY r.updated_at DESC
             LIMIT 5"
        )?;

        let recent_recordings = stmt.query_map([], |row| {
            Ok(Recording {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                documentation: row.get(4)?,
                step_count: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>>>()?;

        Ok(Statistics {
            total_recordings,
            total_steps,
            recordings_this_week,
            recent_recordings,
        })
    }

    pub fn get_steps_for_recording(&self, recording_id: &str) -> Result<Vec<Step>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, recording_id, type_, x, y, text, timestamp, screenshot_path,
                    element_name, element_type, element_value, app_name, order_index
             FROM steps WHERE recording_id = ?1 ORDER BY order_index"
        )?;

        let steps = stmt.query_map(params![recording_id], |row| {
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
            })
        })?.collect::<Result<Vec<_>>>()?;

        Ok(steps)
    }
}
