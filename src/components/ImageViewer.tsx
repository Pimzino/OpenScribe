import { X } from 'lucide-react';

interface ImageViewerProps {
    imageSrc: string;
    title?: string;
    onClose: () => void;
}

export default function ImageViewer({ imageSrc, title, onClose }: ImageViewerProps) {
    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="glass-surface-2 rounded-2xl shadow-2xl max-w-[95vw] w-full max-h-[95vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#161316]/90 rounded-t-2xl">
                    <h3 className="text-lg font-semibold text-white">{title || 'View Screenshot'}</h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-white"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Image Area */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-[#161316]">
                    <img
                        src={imageSrc}
                        alt={title || 'Screenshot'}
                        className="max-h-[80vh] max-w-full object-contain"
                    />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end p-4 border-t border-white/10 bg-[#161316]/90 rounded-b-2xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm bg-white/15 hover:bg-white/25 rounded-lg transition-colors text-white font-medium"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

