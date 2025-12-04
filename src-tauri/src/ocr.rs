//! OCR module for extracting text from screenshots using PaddleOCR ONNX models.
//!
//! This module provides:
//! - OcrEngine initialization and management
//! - Image cropping around click points
//! - Result aggregation

use image::DynamicImage;
use pure_onnx_ocr::{OcrEngine, OcrEngineBuilder};
use std::path::PathBuf;
use std::sync::Arc;

/// OCR configuration
#[derive(Clone)]
pub struct OcrConfig {
    /// Radius around click point for cropping (default: 300)
    pub crop_radius: u32,
    /// Minimum confidence threshold (default: 0.5)
    pub min_confidence: f32,
}

impl Default for OcrConfig {
    fn default() -> Self {
        Self {
            crop_radius: 300,
            min_confidence: 0.5,
        }
    }
}

/// Data sent to OCR thread for processing
#[derive(Clone)]
pub struct OcrJob {
    pub step_id: String,
    pub image: DynamicImage,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub step_type: String,
}

/// Result from OCR processing
#[derive(Clone, Debug, serde::Serialize)]
pub struct OcrJobResult {
    pub step_id: String,
    pub ocr_text: Option<String>,
    pub status: String,
}

/// Manages OCR engine lifecycle and provides processing functions
pub struct OcrManager {
    engine: Option<Arc<OcrEngine>>,
    config: OcrConfig,
}

impl OcrManager {
    /// Create a new OCR manager, loading models from bundled resources
    pub fn new(models_dir: PathBuf, config: OcrConfig) -> Result<Self, String> {
        let det_model = models_dir.join("det.onnx");
        let rec_model = models_dir.join("rec.onnx");
        let dictionary = models_dir.join("ppocr_keys_v1.txt");

        // Validate model files exist
        if !det_model.exists() {
            return Err(format!("Detection model not found: {:?}", det_model));
        }
        if !rec_model.exists() {
            return Err(format!("Recognition model not found: {:?}", rec_model));
        }
        if !dictionary.exists() {
            return Err(format!("Dictionary not found: {:?}", dictionary));
        }

        // Initialize the OCR engine
        let engine = OcrEngineBuilder::new()
            .det_model_path(det_model.to_string_lossy().to_string())
            .rec_model_path(rec_model.to_string_lossy().to_string())
            .dictionary_path(dictionary.to_string_lossy().to_string())
            .build()
            .map_err(|e| format!("Failed to build OCR engine: {:?}", e))?;

        Ok(Self {
            engine: Some(Arc::new(engine)),
            config,
        })
    }

    /// Create a disabled OCR manager (when models not available)
    pub fn disabled() -> Self {
        Self {
            engine: None,
            config: OcrConfig::default(),
        }
    }

    /// Check if OCR is enabled and ready
    pub fn is_enabled(&self) -> bool {
        self.engine.is_some()
    }

    /// Crop image around click point
    pub fn crop_around_point(&self, image: &DynamicImage, x: i32, y: i32) -> DynamicImage {
        let radius = self.config.crop_radius as i32;
        let (width, height) = (image.width() as i32, image.height() as i32);

        let start_x = (x - radius).max(0) as u32;
        let start_y = (y - radius).max(0) as u32;
        let end_x = (x + radius).min(width) as u32;
        let end_y = (y + radius).min(height) as u32;

        let crop_width = end_x - start_x;
        let crop_height = end_y - start_y;

        image.crop_imm(start_x, start_y, crop_width, crop_height)
    }

    /// Process a single OCR job
    pub fn process_job(&self, job: &OcrJob) -> OcrJobResult {
        let Some(engine) = &self.engine else {
            return OcrJobResult {
                step_id: job.step_id.clone(),
                ocr_text: None,
                status: "failed".to_string(),
            };
        };

        // Crop image for click steps
        let image_to_process = if job.step_type == "click" {
            if let (Some(x), Some(y)) = (job.x, job.y) {
                self.crop_around_point(&job.image, x, y)
            } else {
                job.image.clone()
            }
        } else {
            // For type/capture steps, use full image
            job.image.clone()
        };

        // Run OCR - pass the DynamicImage directly
        match engine.run_from_image(&image_to_process) {
            Ok(results) => {
                if results.is_empty() {
                    OcrJobResult {
                        step_id: job.step_id.clone(),
                        ocr_text: None,
                        status: "completed".to_string(),
                    }
                } else {
                    // Aggregate all detected text, filtering by confidence
                    let text: String = results
                        .iter()
                        .filter(|r| r.confidence >= self.config.min_confidence)
                        .map(|r| r.text.as_str())
                        .collect::<Vec<_>>()
                        .join("\n");

                    OcrJobResult {
                        step_id: job.step_id.clone(),
                        ocr_text: if text.is_empty() { None } else { Some(text) },
                        status: "completed".to_string(),
                    }
                }
            }
            Err(e) => {
                eprintln!("OCR error for step {}: {:?}", job.step_id, e);
                OcrJobResult {
                    step_id: job.step_id.clone(),
                    ocr_text: None,
                    status: "failed".to_string(),
                }
            }
        }
    }
}

/// Get the OCR models directory path
pub fn get_models_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    // For development builds, use compile-time path
    #[cfg(debug_assertions)]
    {
        // CARGO_MANIFEST_DIR is set at compile time to the directory containing Cargo.toml
        // which is src-tauri/
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let dev_path = PathBuf::from(manifest_dir).join("resources").join("ocr_models");
        println!("OCR dev path: {:?} (exists: {})", dev_path, dev_path.exists());
        if dev_path.exists() {
            return dev_path;
        }
    }

    // Try to get the resource directory (bundled with app in production)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        // In production, resources are bundled
        let candidates = [
            resource_dir.join("resources").join("ocr_models"),
            resource_dir.join("ocr_models"),
        ];

        for candidate in &candidates {
            if candidate.exists() {
                println!("Found OCR models at: {:?}", candidate);
                return candidate.clone();
            }
        }
    }

    // Fallback: try paths relative to executable
    if let Ok(exe_path) = std::env::current_exe() {
        // Canonicalize to resolve symlinks and get absolute path
        if let Ok(exe_path) = exe_path.canonicalize() {
            if let Some(parent) = exe_path.parent() {
                let candidates = [
                    parent.join("resources").join("ocr_models"),
                    parent.join("_up_").join("resources").join("ocr_models"),
                ];

                for candidate in &candidates {
                    // Try to canonicalize to resolve .. properly
                    let resolved = if candidate.to_string_lossy().contains("_up_") {
                        // Manual parent traversal for Windows compatibility
                        parent.parent()
                            .and_then(|p| p.parent())
                            .map(|p| p.join("resources").join("ocr_models"))
                    } else {
                        Some(candidate.clone())
                    };

                    if let Some(path) = resolved {
                        if path.exists() {
                            println!("Found OCR models at: {:?}", path);
                            return path;
                        }
                    }
                }
            }
        }
    }

    // Last resort
    println!("OCR models not found in any expected location");
    PathBuf::from("resources").join("ocr_models")
}
