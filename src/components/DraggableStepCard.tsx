import { useState, useMemo, memo } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Trash2, Pencil, GripVertical, ImageOff } from "lucide-react";
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
    screenshot_after?: string; // For NewRecording page (after-frame)
    screenshot_after_path?: string; // For RecordingDetail page (after-frame)
    element_name?: string;
    element_type?: string;
    element_value?: string;
    app_name?: string;
    description?: string;
    is_cropped?: boolean;
    input_source?: string;
    clip_path?: string;
    title?: string;
}

interface DraggableStepCardProps {
    step: Step;
    index: number;
    id: string;
    onDelete?: () => void;
    /** Receives "after" when the user is currently viewing the after-frame,
     *  so the image editor edits the correct image. */
    onCrop?: (target: "before" | "after") => void;
    onUpdateDescription: (description: string) => void;
    onUpdateTitle?: (title: string) => void;
    isDeleting?: boolean;
    cropTimestamp?: number;
}

const defaultTitleForStep = (step: Step, index: number): string => {
    if (step.title && step.title.trim().length > 0) {
        return step.title;
    }
    if (step.type_ === "click") {
        return step.element_name ? `Click ${step.element_name}` : `Click action`;
    }
    if (step.type_ === "type") {
        return step.text ? `Type "${step.text}"` : `Type action`;
    }
    if (step.type_ === "capture") {
        return `Manual capture`;
    }
    return `Step ${index + 1}`;
};

const DraggableStepCard = memo(function DraggableStepCard({
    step,
    index,
    id,
    onDelete,
    onCrop,
    onUpdateDescription,
    onUpdateTitle,
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

    const beforePath = step.screenshot || step.screenshot_path;
    const afterPath = step.screenshot_after || step.screenshot_after_path;
    const hasScreenshot = Boolean(beforePath);
    const hasAfter = Boolean(afterPath);
    const [isViewerOpen, setIsViewerOpen] = useState(false);
    // Per-card local state. Resets on remount. We never persist this — it's a
    // viewing preference, not a property of the step itself.
    const [frameMode, setFrameMode] = useState<"before" | "after">("before");

    const showingAfter = frameMode === "after" && hasAfter;
    const activePath = showingAfter ? afterPath : beforePath;
    const screenshotSrc = useMemo(
        () => activePath
            ? convertFileSrc(activePath) + (cropTimestamp ? `?t=${cropTimestamp}` : '')
            : '',
        [activePath, cropTimestamp]
    );

    const titleValue = step.title ?? "";
    const titlePlaceholder = defaultTitleForStep(step, index);

    return (
        <>
            {isViewerOpen && hasScreenshot && (
                <ImageViewer
                    imageSrc={screenshotSrc}
                    title={`Step ${index + 1} ${showingAfter ? "(After)" : "Screenshot"}`}
                    onClose={() => setIsViewerOpen(false)}
                />
            )}
            <div
                ref={setNodeRef}
                style={style}
                className="glass-surface-2 rounded-2xl overflow-hidden relative flex flex-col"
            >
                {/* Header: drag handle + step number + title input */}
                <div className="flex items-start gap-3 px-5 pt-5">
                    <div
                        {...attributes}
                        {...listeners}
                        className="mt-2 cursor-grab active:cursor-grabbing p-1 text-white/40 hover:text-white/70 transition-colors"
                        aria-label="Drag to reorder"
                    >
                        <GripVertical size={18} />
                    </div>
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-sm font-semibold text-white/80">
                        {index + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                        <label className="block text-[11px] font-medium uppercase tracking-wide text-white/40 mb-1">
                            Step title <span className="text-[#49B8D3]">*</span>
                        </label>
                        <input
                            type="text"
                            value={titleValue}
                            onChange={(event) => onUpdateTitle?.(event.target.value)}
                            placeholder={titlePlaceholder}
                            disabled={!onUpdateTitle}
                            className="w-full bg-transparent border-b border-white/10 px-0 py-1.5 text-base font-medium text-white/90 placeholder-white/30 focus:outline-none focus:border-[#2721E8] transition-colors disabled:cursor-not-allowed"
                        />
                    </div>
                </div>

                {/* Description */}
                <div className="px-5 pt-4">
                    <textarea
                        value={step.description || ""}
                        onChange={(event) => onUpdateDescription(event.target.value)}
                        placeholder="Describe what happens in this step..."
                        rows={3}
                        className="w-full resize-y rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm leading-relaxed text-white/85 placeholder-white/35 focus:outline-none focus:border-[#2721E8] focus:bg-white/[0.07] transition-colors"
                    />
                </div>

                {/* Step type metadata badge (clicks/types) */}
                {(step.type_ === "click" || step.type_ === "type") && (
                    <div className="px-5 pt-3">
                        {step.type_ === "click" && (
                            <p className="text-xs text-white/45">
                                Click at ({Math.round(step.x || 0)}, {Math.round(step.y || 0)})
                                {step.element_name ? ` · ${step.element_name}` : ''}
                            </p>
                        )}
                        {step.type_ === "type" && step.text && (
                            <div className="relative rounded-md bg-[#161316] border border-white/8 px-3 py-2 font-mono text-xs text-[#49B8D3] break-words">
                                "{step.text}"
                                {step.input_source && (
                                    <Tooltip
                                        content={
                                            step.input_source === "ax_value" || step.input_source === "ax_text" || step.input_source === "ax_legacy"
                                                ? `Final value read from the input field via accessibility API (${step.input_source})`
                                                : step.input_source === "keystrokes"
                                                    ? "Raw keystroke buffer — autocomplete, paste, and IME input may be incomplete"
                                                    : `Source: ${step.input_source}`
                                        }
                                    >
                                        <span
                                            className={`absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-medium font-sans ${
                                                step.input_source === "keystrokes"
                                                    ? "bg-white/10 text-white/60"
                                                    : "bg-green-600/30 text-green-300"
                                            }`}
                                        >
                                            {step.input_source === "keystrokes" ? "Keys" : "AX"}
                                        </span>
                                    </Tooltip>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Screenshot */}
                <div className="px-5 pt-4">
                    <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#161316]">
                        {hasScreenshot ? (
                            <>
                                <img
                                    src={screenshotSrc}
                                    alt={`Step ${index + 1} ${showingAfter ? "after-frame" : "screenshot"}`}
                                    loading="lazy"
                                    decoding="async"
                                    className="w-full h-auto max-h-[420px] object-contain cursor-pointer hover:opacity-95 transition-opacity"
                                    onClick={() => setIsViewerOpen(true)}
                                />
                                <div className="absolute top-2 left-2 bg-black/55 px-2 py-1 rounded text-[11px] text-white/85">
                                    {new Date(step.timestamp).toLocaleTimeString()}
                                </div>
                                {step.is_cropped && (
                                    <div className="absolute bottom-2 left-2 bg-blue-600/85 px-2 py-1 rounded text-[11px]">
                                        Edited
                                    </div>
                                )}
                                {step.clip_path && (
                                    <Tooltip content="Video clip captured for this step">
                                        <div className="absolute bottom-2 left-20 bg-purple-600/80 px-2 py-1 rounded text-[10px] font-medium">
                                            Clip
                                        </div>
                                    </Tooltip>
                                )}
                                {/* Before/After toggle — only when both frames exist. */}
                                {hasAfter && (
                                    <div
                                        className="absolute bottom-2 right-2 inline-flex bg-black/60 rounded-md overflow-hidden text-[10px] font-medium select-none"
                                        onClick={(e) => e.stopPropagation()}
                                        role="group"
                                        aria-label="Choose frame to display"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => setFrameMode("before")}
                                            aria-pressed={frameMode === "before"}
                                            className={`px-2 py-1 transition-colors ${
                                                frameMode === "before"
                                                    ? "bg-white/15 text-white"
                                                    : "text-white/60 hover:text-white/80"
                                            }`}
                                        >
                                            Before
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setFrameMode("after")}
                                            aria-pressed={frameMode === "after"}
                                            className={`px-2 py-1 transition-colors ${
                                                frameMode === "after"
                                                    ? "bg-white/15 text-white"
                                                    : "text-white/60 hover:text-white/80"
                                            }`}
                                        >
                                            After
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="flex h-40 w-full flex-col items-center justify-center text-white/40">
                                <ImageOff size={32} className="mb-2" />
                                <span className="text-xs">No image</span>
                            </div>
                        )}
                    </div>

                    {/* Image action buttons (under screenshot) */}
                    <div className="mt-3 flex items-center justify-end gap-2">
                        {hasScreenshot && onCrop && (
                            <Tooltip content={showingAfter ? "Edit after-frame" : "Edit screenshot"}>
                                <button
                                    onClick={() => onCrop(showingAfter ? "after" : "before")}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-[#2721E8]/60 bg-[#2721E8]/10 px-3 py-1.5 text-xs font-medium text-[#9d99ff] hover:bg-[#2721E8]/20 transition-colors"
                                >
                                    <Pencil size={13} />
                                    Edit image
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>

                {/* Footer: Delete */}
                {onDelete && (
                    <div className="mt-4 border-t border-white/8 px-5 py-3">
                        <button
                            onClick={onDelete}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDeleting ? <Spinner size="sm" /> : <Trash2 size={14} />}
                            Delete
                        </button>
                    </div>
                )}
            </div>
        </>
    );
});

export default DraggableStepCard;
