import { useState, useMemo, memo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Crop, GripVertical, ImageOff, Expand } from "lucide-react";
import Tooltip from "./Tooltip";
import Spinner from "./Spinner";
import ImageViewer from "./ImageViewer";

interface Step {
    type_: string;
    x?: number;
    y?: number;
    text?: string;
    timestamp: number;
    screenshot?: string; // For NewRecording page
    screenshot_path?: string; // For RecordingDetail page
    element_name?: string;
    element_type?: string;
    element_value?: string;
    app_name?: string;
    description?: string;
    is_cropped?: boolean;
}

interface DraggableStepCardProps {
    step: Step;
    index: number;
    id: string;
    onDelete?: () => void;
    onCrop?: () => void;
    onUpdateDescription: (description: string) => void;
    isDeleting?: boolean;
    cropTimestamp?: number;
}

const DraggableStepCard = memo(function DraggableStepCard({
    step,
    index,
    id,
    onDelete,
    onCrop,
    onUpdateDescription,
    isDeleting,
    cropTimestamp,
}: DraggableStepCardProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    const hasScreenshot = step.screenshot || step.screenshot_path;
    const [isViewerOpen, setIsViewerOpen] = useState(false);

    const screenshotSrc = useMemo(
        () => hasScreenshot
            ? convertFileSrc(step.screenshot || step.screenshot_path!) + (cropTimestamp ? `?t=${cropTimestamp}` : '')
            : '',
        [hasScreenshot, step.screenshot, step.screenshot_path, cropTimestamp]
    );

    return (
        <>
        {isViewerOpen && hasScreenshot && (
            <ImageViewer
                imageSrc={screenshotSrc}
                title={`Step ${index + 1} Screenshot`}
                onClose={() => setIsViewerOpen(false)}
            />
        )}
        <div
            ref={setNodeRef}
            style={style}
            className="glass-surface-2 rounded-xl overflow-hidden relative h-80 flex flex-col"
        >
            {/* Drag Handle */}
            <div
                {...attributes}
                {...listeners}
                className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing p-1 bg-white/10 hover:bg-white/15 rounded transition-colors"
            >
                <GripVertical size={16} className="text-white/70" />
            </div>

            {/* Action Buttons */}
            <div className="absolute top-2 right-2 z-10 flex gap-1">
                {hasScreenshot && (
                    <Tooltip content="View full size">
                        <button
                            onClick={() => setIsViewerOpen(true)}
                            className="p-1 bg-white/10 hover:bg-white/15 rounded-full flex items-center justify-center transition-colors"
                        >
                            <Expand size={14} />
                        </button>
                    </Tooltip>
                )}
                {hasScreenshot && onCrop && (
                    <Tooltip content="Crop screenshot">
                        <button
                            onClick={onCrop}
                            className="p-1 bg-[#2721E8] hover:bg-[#4a45f5] rounded-full flex items-center justify-center transition-colors"
                        >
                            <Crop size={14} />
                        </button>
                    </Tooltip>
                )}
                {onDelete && (
                    <Tooltip content="Delete step">
                        <button
                            onClick={onDelete}
                            disabled={isDeleting}
                            className="p-1 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDeleting ? <Spinner size="sm" /> : <X size={14} />}
                        </button>
                    </Tooltip>
                )}
            </div>

            {/* Screenshot */}
            <div className="h-40 flex-shrink-0 bg-[#161316] relative">
                {hasScreenshot ? (
                    <>
                        <img
                            src={screenshotSrc}
                            alt={`Step ${index + 1}`}
                            loading="lazy"
                            decoding="async"
                            className="w-full h-full object-cover cursor-pointer hover:opacity-90"
                            onClick={() => setIsViewerOpen(true)}
                        />
                        <div className="absolute top-2 left-12 bg-black/50 px-2 py-1 rounded text-xs">
                            {new Date(step.timestamp).toLocaleTimeString()}
                        </div>
                        {step.is_cropped && (
                            <div className="absolute bottom-2 left-2 bg-blue-600/80 px-2 py-1 rounded text-xs">
                                Cropped
                            </div>
                        )}
                    </>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-white/50">
                        <ImageOff size={32} className="mb-2" />
                        <span className="text-xs">No image</span>
                    </div>
                )}
            </div>

            {/* Step Content */}
            <div className="p-4 flex-1 overflow-hidden flex flex-col">
                <h3 className="font-medium text-sm text-white/80 mb-2 flex-shrink-0">
                    Step {index + 1} ({step.type_ === "click" ? "Click" : step.type_ === "type" ? "Type" : "Capture"})
                </h3>
                <div className="flex-1 overflow-y-auto min-h-0">
                    {step.type_ === "click" && (
                        <p className="text-xs text-white/50 mb-2">
                            Clicked at ({Math.round(step.x || 0)}, {Math.round(step.y || 0)})
                        </p>
                    )}
                    {step.type_ === "type" && step.text && (
                        <div className="bg-[#161316] p-3 rounded border border-white/8 font-mono text-sm text-[#49B8D3] break-words mb-2">
                            "{step.text}"
                        </div>
                    )}
                    {step.type_ === "capture" && (
                        <p className="text-xs text-white/50 mb-2">
                            Manual screenshot capture
                        </p>
                    )}
                </div>
                <textarea
                    value={step.description || ""}
                    onChange={(e) => onUpdateDescription(e.target.value)}
                    placeholder="Add description for AI (optional)..."
                    className="w-full px-2 py-1 bg-[#161316] border border-white/8 rounded text-xs text-white/80 placeholder-white/40 focus:outline-none focus:border-[#2721E8] resize-none flex-shrink-0"
                    rows={2}
                />
            </div>
        </div>
        </>
    );
});

export default DraggableStepCard;

