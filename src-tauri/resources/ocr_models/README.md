# OCR Models

This directory contains PaddleOCR PP-OCRv5 ONNX models required for the OCR feature.

## Required Files

- `det.onnx` - Text detection model (DBNet, ~4.6MB)
- `rec.onnx` - Text recognition model (SVTR, ~16MB)
- `ppocr_keys_v1.txt` - Character dictionary (~200KB)

## Download

Run one of the download scripts from the project root:

**Windows (PowerShell):**
```powershell
.\scripts\download_ocr_models.ps1
```

**Linux/macOS:**
```bash
./scripts/download_ocr_models.sh
```

## Source

Models are from [MeKo-Christian/paddleocr-onnx](https://github.com/MeKo-Christian/paddleocr-onnx)
which exports official PaddleOCR PP-OCRv5 models to ONNX format.

Dictionary from [PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR).

## License

Apache-2.0 (same as PaddleOCR)
