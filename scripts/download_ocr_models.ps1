# Download PaddleOCR PP-OCRv5 ONNX models for OpenScribe OCR feature
# These models are required for text extraction from screenshots

$ErrorActionPreference = "Stop"

$ModelsDir = "src-tauri\resources\ocr_models"
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

Write-Host "Downloading PP-OCRv5 Mobile ONNX models..." -ForegroundColor Cyan

# Detection model (~4.6MB)
Write-Host "Downloading detection model (det.onnx)..."
Invoke-WebRequest -Uri "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0/PP-OCRv5_mobile_det.onnx" -OutFile "$ModelsDir\det.onnx"

# Recognition model (~16MB)
Write-Host "Downloading recognition model (rec.onnx)..."
Invoke-WebRequest -Uri "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0/PP-OCRv5_mobile_rec.onnx" -OutFile "$ModelsDir\rec.onnx"

# Character dictionary
Write-Host "Downloading character dictionary..."
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt" -OutFile "$ModelsDir\ppocr_keys_v1.txt"

Write-Host ""
Write-Host "Done! Models downloaded to $ModelsDir" -ForegroundColor Green
Write-Host ""
Write-Host "Files:"
Get-ChildItem $ModelsDir | Format-Table Name, Length
