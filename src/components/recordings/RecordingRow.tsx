import { Trash2 } from "lucide-react";
import type { Recording } from "../../store/recordingsStore";
import Tooltip from "../Tooltip";
import RecordingThumbnail from "./RecordingThumbnail";
import { formatRelativeTime } from "../../lib/relativeTime";
import { formatDuration } from "../../lib/recordingMeta";

interface RecordingRowProps {
    recording: Recording;
    onOpen: (id: string) => void;
    onPreload?: () => void;
    onDelete: (id: string, name: string) => void;
}

export default function RecordingRow({
    recording,
    onOpen,
    onPreload,
    onDelete,
}: RecordingRowProps) {
    const duration = formatDuration(recording.duration_ms);
    const stepLabel = `${recording.step_count} ${recording.step_count === 1 ? "step" : "steps"}`;
    const metaParts = [stepLabel, duration, formatRelativeTime(recording.updated_at)].filter(
        (p): p is string => Boolean(p)
    );

    return (
        <div className="group flex items-center transition-colors hover:bg-white/5">
            <button
                onMouseEnter={onPreload}
                onFocus={onPreload}
                onClick={() => onOpen(recording.id)}
                className="flex min-w-0 flex-1 items-center gap-4 p-3 text-left"
            >
                <RecordingThumbnail
                    id={recording.id}
                    screenshotPath={recording.first_screenshot_path}
                />
                <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{recording.name}</p>
                    <p className="mt-0.5 truncate text-sm text-white/50">
                        {metaParts.join(" · ")}
                    </p>
                </div>
            </button>
            <div className="flex flex-shrink-0 items-center gap-3 pr-3">
                <Tooltip content="Delete recording">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(recording.id, recording.name);
                        }}
                        className="rounded-md p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-red-500"
                        aria-label="Delete recording"
                    >
                        <Trash2 size={18} />
                    </button>
                </Tooltip>
            </div>
        </div>
    );
}
