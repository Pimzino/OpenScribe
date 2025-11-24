import { convertFileSrc } from "@tauri-apps/api/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X, Crop, GripVertical } from "lucide-react";
import Tooltip from "./Tooltip";
import Spinner from "./Spinner";

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

export default function DraggableStepCard({
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

    return (
        <div
            ref={setNodeRef}
            style={style}
            className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden relative"
        >
            {/* Drag Handle */}
            <div
                {...attributes}
                {...listeners}
                className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing p-1 bg-zinc-800/80 hover:bg-zinc-700/80 rounded transition-colors"
            >
                <GripVertical size={16} className="text-zinc-400" />
            </div>

            {/* Action Buttons */}
            <div className="absolute top-2 right-2 z-10 flex gap-1">
                {(step.screenshot || step.screenshot_path) && onCrop && (
                    <Tooltip content="Crop screenshot">
                        <button
                            onClick={onCrop}
                            className="p-1 bg-blue-600 hover:bg-blue-700 rounded-full flex items-center justify-center transition-colors"
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
            {(step.screenshot || step.screenshot_path) && (
                <div className="aspect-video bg-zinc-950 relative">
                    <img
                        src={convertFileSrc(step.screenshot || step.screenshot_path!) + (cropTimestamp ? `?t=${cropTimestamp}` : '')}
                        alt={`Step ${index + 1}`}
                        className="w-full h-full object-cover"
                    />
                    <div className="absolute top-2 left-12 bg-black/50 px-2 py-1 rounded text-xs">
                        {new Date(step.timestamp).toLocaleTimeString()}
                    </div>
                    {step.is_cropped && (
                        <div className="absolute bottom-2 left-2 bg-blue-600/80 px-2 py-1 rounded text-xs">
                            Cropped
                        </div>
                    )}
                </div>
            )}

            {/* Step Content */}
            <div className="p-4">
                <h3 className="font-medium text-sm text-zinc-300 mb-2">
                    Step {index + 1} ({step.type_ === "click" ? "Click" : step.type_ === "type" ? "Type" : "Capture"})
                </h3>
                {step.type_ === "click" && (
                    <p className="text-xs text-zinc-500 mb-2">
                        Clicked at ({Math.round(step.x || 0)}, {Math.round(step.y || 0)})
                    </p>
                )}
                {step.type_ === "type" && step.text && (
                    <div className="bg-zinc-950 p-3 rounded border border-zinc-800 font-mono text-sm text-blue-400 break-words mb-2">
                        "{step.text}"
                    </div>
                )}
                {step.type_ === "capture" && (
                    <p className="text-xs text-zinc-500 mb-2">
                        Manual screenshot capture
                    </p>
                )}
                <textarea
                    value={step.description || ""}
                    onChange={(e) => onUpdateDescription(e.target.value)}
                    placeholder="Add description for AI (optional)..."
                    className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
                    rows={2}
                />
            </div>
        </div>
    );
}

