import { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { X, Check, RotateCcw } from 'lucide-react';

interface ImageCropperProps {
    imageSrc: string;
    onSave: (croppedImageBase64: string) => void;
    onCancel: () => void;
}

function centerAspectCrop(
    mediaWidth: number,
    mediaHeight: number,
) {
    return centerCrop(
        makeAspectCrop(
            {
                unit: '%',
                width: 90,
            },
            mediaWidth / mediaHeight,
            mediaWidth,
            mediaHeight,
        ),
        mediaWidth,
        mediaHeight,
    );
}

export default function ImageCropper({ imageSrc, onSave, onCancel }: ImageCropperProps) {
    const [crop, setCrop] = useState<Crop>();
    const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
    const imgRef = useRef<HTMLImageElement>(null);

    const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const { width, height } = e.currentTarget;
        setCrop(centerAspectCrop(width, height));
    }, []);

    const handleReset = () => {
        if (imgRef.current) {
            const { width, height } = imgRef.current;
            setCrop(centerAspectCrop(width, height));
        }
    };

    const handleSave = async () => {
        if (!completedCrop || !imgRef.current) {
            return;
        }

        const image = imgRef.current;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            return;
        }

        // Calculate scale between natural and displayed size
        const scaleX = image.naturalWidth / image.width;
        const scaleY = image.naturalHeight / image.height;

        // Set canvas size to cropped area
        canvas.width = completedCrop.width * scaleX;
        canvas.height = completedCrop.height * scaleY;

        // Draw cropped image
        ctx.drawImage(
            image,
            completedCrop.x * scaleX,
            completedCrop.y * scaleY,
            completedCrop.width * scaleX,
            completedCrop.height * scaleY,
            0,
            0,
            canvas.width,
            canvas.height
        );

        // Convert to base64 (without data URL prefix)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        onSave(base64);
    };

    return createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onCancel}
        >
            <div
                className="glass-surface-2 rounded-2xl shadow-2xl max-w-[95vw] w-full max-h-[95vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#161316]/90 rounded-t-2xl">
                    <h3 className="text-lg font-semibold text-white">Crop Screenshot</h3>
                    <button
                        onClick={onCancel}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-white"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Crop Area */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[#161316]">
                    <ReactCrop
                        crop={crop}
                        onChange={(_, percentCrop) => setCrop(percentCrop)}
                        onComplete={(c) => setCompletedCrop(c)}
                        className="max-h-full"
                    >
                        <img
                            ref={imgRef}
                            src={imageSrc}
                            alt="Crop preview"
                            onLoad={onImageLoad}
                            crossOrigin="anonymous"
                            className="max-h-[80vh] max-w-full object-contain"
                        />
                    </ReactCrop>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between p-4 border-t border-white/10 bg-[#161316]/90 rounded-b-2xl">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-3 py-2 text-sm bg-white/10 hover:bg-white/15 rounded-lg transition-colors text-white font-medium"
                    >
                        <RotateCcw size={16} />
                        Reset
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 text-sm bg-white/15 hover:bg-white/25 rounded-lg transition-colors text-white font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!completedCrop}
                            className="flex items-center gap-2 px-4 py-2 text-sm bg-[#2721E8] hover:bg-[#4a45f5] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-white font-medium"
                        >
                            <Check size={16} />
                            Save Crop
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
