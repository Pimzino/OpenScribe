import { X } from 'lucide-react';

interface ImageViewerProps {
    imageSrc: string;
    title?: string;
    onClose: () => void;
}

export default function ImageViewer({ imageSrc, title, onClose }: ImageViewerProps) {
    return (
        <div
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className="bg-zinc-900 rounded-lg max-w-5xl w-full max-h-[90vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                    <h3 className="text-lg font-semibold">{title || 'View Screenshot'}</h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-zinc-800 rounded transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Image Area */}
                <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-zinc-950">
                    <img
                        src={imageSrc}
                        alt={title || 'Screenshot'}
                        className="max-h-[70vh] max-w-full object-contain"
                    />
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end p-4 border-t border-zinc-800">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

