#!/bin/bash
# Download PaddleOCR PP-OCRv5 ONNX models for OpenScribe OCR feature
# These models are required for text extraction from screenshots

set -e

MODELS_DIR="src-tauri/resources/ocr_models"
mkdir -p "$MODELS_DIR"

echo "Downloading PP-OCRv5 Mobile ONNX models..."

# Detection model (~4.6MB)
echo "Downloading detection model (det.onnx)..."
curl -L -o "$MODELS_DIR/det.onnx" \
    "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0/PP-OCRv5_mobile_det.onnx"

# Recognition model (~16MB)
echo "Downloading recognition model (rec.onnx)..."
curl -L -o "$MODELS_DIR/rec.onnx" \
    "https://github.com/MeKo-Christian/paddleocr-onnx/releases/download/v1.0.0/PP-OCRv5_mobile_rec.onnx"

# Character dictionary
echo "Downloading character dictionary..."
curl -L -o "$MODELS_DIR/ppocr_keys_v1.txt" \
    "https://raw.githubusercontent.com/PaddlePaddle/PaddleOCR/main/ppocr/utils/ppocr_keys_v1.txt"

echo ""
echo "Done! Models downloaded to $MODELS_DIR"
echo ""
echo "Files:"
ls -lh "$MODELS_DIR"
