import { useMemo } from "react";
import type { Recording } from "../../store/recordingsStore";
import RecordingRow from "./RecordingRow";
import { bucketRecordingsByDate } from "../../lib/recordingMeta";

interface RecordingsListViewProps {
    recordings: Recording[];
    onOpen: (id: string) => void;
    onPreload?: () => void;
    onDelete: (id: string, name: string) => void;
}

export default function RecordingsListView({
    recordings,
    onOpen,
    onPreload,
    onDelete,
}: RecordingsListViewProps) {
    const buckets = useMemo(() => bucketRecordingsByDate(recordings), [recordings]);

    return (
        <div className="space-y-5">
            {buckets.map((bucket) => (
                <section key={bucket.key}>
                    <h3 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">
                        {bucket.label}
                    </h3>
                    <div className="glass-surface-2 rounded-xl divide-y divide-white/8 overflow-hidden">
                        {bucket.items.map((rec) => (
                            <RecordingRow
                                key={rec.id}
                                recording={rec}
                                onOpen={onOpen}
                                onPreload={onPreload}
                                onDelete={onDelete}
                            />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
