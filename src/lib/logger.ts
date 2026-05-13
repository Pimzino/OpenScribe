// Frontend logger that writes through to the file-based Rust logger.
//
// Every call invokes the `log_event` Tauri command, so a single grep across
// AppData\Roaming\stepsnap\logs answers "what did the app do at 14:32?"
// regardless of whether the work happened in TS or Rust.
//
// Calls are fire-and-forget: a logging failure must never break business logic.

import { invoke } from "@tauri-apps/api/core";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export type LogCategory =
    | "app"
    | "ai"
    | "recorder"
    | "database"
    | "accessibility"
    | "ocr"
    | "ui";

interface LogPayload {
    category: LogCategory;
    level: LogLevel;
    message: string;
    metadata?: Record<string, unknown> | null;
}

function sanitizeMetadata(meta: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!meta) return null;
    // Drop anything that can't be JSON-serialised cleanly. Errors are unfolded
    // so their `name`, `message`, and `stack` make it to disk.
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(meta)) {
        if (value instanceof Error) {
            out[key] = {
                name: value.name,
                message: value.message,
                stack: value.stack,
            };
        } else if (value === undefined) {
            continue;
        } else {
            out[key] = value;
        }
    }
    return out;
}

function emit(payload: LogPayload): void {
    invoke("log_event", {
        payload: {
            category: payload.category,
            level: payload.level,
            message: payload.message,
            metadata: sanitizeMetadata(payload.metadata),
        },
    }).catch((err) => {
        // Last-resort: surface the failure on the console so we don't lose it.
        // eslint-disable-next-line no-console
        console.error("[logger] log_event invoke failed:", err);
    });

    // Mirror to console for live development.
    const consoleMethod =
        payload.level === "error"
            ? "error"
            : payload.level === "warn"
              ? "warn"
              : payload.level === "debug" || payload.level === "trace"
                ? "debug"
                : "log";
    // eslint-disable-next-line no-console
    console[consoleMethod](`[${payload.category}] ${payload.message}`, payload.metadata ?? "");
}

interface LoggerApi {
    trace: (message: string, metadata?: Record<string, unknown>) => void;
    debug: (message: string, metadata?: Record<string, unknown>) => void;
    info: (message: string, metadata?: Record<string, unknown>) => void;
    warn: (message: string, metadata?: Record<string, unknown>) => void;
    error: (message: string, metadata?: Record<string, unknown>) => void;
}

function makeLogger(category: LogCategory): LoggerApi {
    const at = (level: LogLevel) => (message: string, metadata?: Record<string, unknown>) =>
        emit({ category, level, message, metadata });
    return {
        trace: at("trace"),
        debug: at("debug"),
        info: at("info"),
        warn: at("warn"),
        error: at("error"),
    };
}

export const log = {
    app: makeLogger("app"),
    ai: makeLogger("ai"),
    recorder: makeLogger("recorder"),
    database: makeLogger("database"),
    accessibility: makeLogger("accessibility"),
    ocr: makeLogger("ocr"),
    ui: makeLogger("ui"),
};

/**
 * Convert any thrown value into a structured metadata object so the original
 * detail is preserved on disk even after we render a friendly message in the UI.
 */
export function describeError(error: unknown): { message: string; metadata: Record<string, unknown> } {
    if (error instanceof Error) {
        return {
            message: error.message || error.name || "Unknown error",
            metadata: {
                name: error.name,
                message: error.message,
                stack: error.stack,
            },
        };
    }
    if (typeof error === "string") {
        return { message: error, metadata: { raw: error } };
    }
    try {
        const rendered = JSON.stringify(error);
        return { message: rendered, metadata: { raw: error as Record<string, unknown> } };
    } catch {
        return { message: String(error), metadata: { raw: String(error) } };
    }
}
