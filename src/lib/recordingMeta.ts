import type { Recording } from "../store/recordingsStore";

/**
 * Format an ms duration as `Xh Ym`, `Xm Ys`, or `Xs`. Returns null when the
 * duration is missing, zero, or non-finite — callers should hide the slot.
 */
export function formatDuration(ms: number | null | undefined): string | null {
    if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
    const totalSeconds = Math.floor(ms / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes < 60) {
        return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
}

export interface RecordingBucket {
    key: "today" | "yesterday" | "this-week" | "earlier";
    label: string;
    items: Recording[];
}

const BUCKET_ORDER: RecordingBucket["key"][] = [
    "today",
    "yesterday",
    "this-week",
    "earlier",
];

const BUCKET_LABELS: Record<RecordingBucket["key"], string> = {
    today: "Today",
    yesterday: "Yesterday",
    "this-week": "This week",
    earlier: "Earlier",
};

function startOfDay(date: Date): number {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/**
 * Partition recordings into Today / Yesterday / This week / Earlier buckets
 * based on their `updated_at`. Empty buckets are omitted from the returned
 * array. Order within each bucket preserves input order (the API already
 * sorts by updated_at DESC).
 */
export function bucketRecordingsByDate(
    recordings: Recording[],
    now: Date = new Date()
): RecordingBucket[] {
    const todayStart = startOfDay(now);
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    // "This week" = the trailing 7 days excluding today + yesterday.
    const weekStart = todayStart - 7 * 24 * 60 * 60 * 1000;

    const groups: Record<RecordingBucket["key"], Recording[]> = {
        today: [],
        yesterday: [],
        "this-week": [],
        earlier: [],
    };

    for (const rec of recordings) {
        const ts = rec.updated_at;
        if (ts >= todayStart) groups.today.push(rec);
        else if (ts >= yesterdayStart) groups.yesterday.push(rec);
        else if (ts >= weekStart) groups["this-week"].push(rec);
        else groups.earlier.push(rec);
    }

    return BUCKET_ORDER
        .map((key) => ({ key, label: BUCKET_LABELS[key], items: groups[key] }))
        .filter((b) => b.items.length > 0);
}

