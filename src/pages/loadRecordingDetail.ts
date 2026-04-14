let recordingDetailPromise: Promise<typeof import("./RecordingDetail")> | null = null;

export function loadRecordingDetail() {
    recordingDetailPromise ??= import("./RecordingDetail");
    return recordingDetailPromise;
}

export function scheduleRecordingDetailPreload(delayMs = 250) {
    if (typeof window === "undefined") {
        return () => undefined;
    }

    if ("requestIdleCallback" in window) {
        const idleId = window.requestIdleCallback(() => {
            void loadRecordingDetail();
        }, { timeout: delayMs });

        return () => {
            if ("cancelIdleCallback" in window) {
                window.cancelIdleCallback(idleId);
            }
        };
    }

    const timeoutId = globalThis.setTimeout(() => {
        void loadRecordingDetail();
    }, delayMs);

    return () => globalThis.clearTimeout(timeoutId);
}
