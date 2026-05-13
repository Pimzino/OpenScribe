import { useState } from "react";
import { FolderOpen, RotateCcw, FileText } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../store/settingsStore";
import Tooltip from "../Tooltip";

export default function GeneralSection() {
    const {
        screenshotPath,
        sendScreenshotsToAi,
        setScreenshotPath,
        setSendScreenshotsToAi,
        getDefaultScreenshotPath,
    } = useSettingsStore();

    const [pathError, setPathError] = useState<string | null>(null);
    const [validatingPath, setValidatingPath] = useState(false);

    const validatePath = async (path: string) => {
        if (!path) {
            setPathError(null);
            return;
        }
        setValidatingPath(true);
        try {
            await invoke("validate_screenshot_path", { path });
            setPathError(null);
        } catch (error) {
            setPathError(error as string);
        } finally {
            setValidatingPath(false);
        }
    };

    const handleBrowseFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "Select Screenshot Storage Location",
            });
            if (selected && typeof selected === "string") {
                setScreenshotPath(selected);
                validatePath(selected);
            }
        } catch (error) {
            console.error("Failed to open folder dialog:", error);
        }
    };

    const handleResetPath = async () => {
        const defaultPath = await getDefaultScreenshotPath();
        if (defaultPath) {
            setScreenshotPath(defaultPath);
            setPathError(null);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-white mb-1">General</h3>
                <p className="text-xs text-white/50">Storage location, capture behavior, and application logs.</p>
            </div>

            <div>
                <label className="block text-sm font-medium text-white/80 mb-2">
                    Screenshot Storage Location
                </label>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={screenshotPath}
                        onChange={(e) => {
                            setScreenshotPath(e.target.value);
                            validatePath(e.target.value);
                        }}
                        placeholder="Select a folder..."
                        className={`flex-1 px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-white placeholder-white/50 focus:outline-none transition-colors ${
                            pathError
                                ? "border-red-600 focus:border-red-500"
                                : "border-white/10 focus:border-[#2721E8]"
                        }`}
                    />
                    <Tooltip content="Browse for folder" position="top">
                        <button
                            aria-label="Browse for folder"
                            onClick={handleBrowseFolder}
                            className="px-3 py-2 bg-white/10 border border-white/10 rounded-md hover:bg-white/15 transition-colors"
                        >
                            <FolderOpen size={16} />
                        </button>
                    </Tooltip>
                    <Tooltip content="Reset to default" position="top">
                        <button
                            aria-label="Reset to default"
                            onClick={handleResetPath}
                            className="px-3 py-2 bg-white/10 border border-white/10 rounded-md hover:bg-white/15 transition-colors"
                        >
                            <RotateCcw size={16} />
                        </button>
                    </Tooltip>
                </div>
                {pathError && (
                    <p className="mt-1 text-xs text-red-500">{pathError}</p>
                )}
                {validatingPath && (
                    <p className="mt-1 text-xs text-white/50">Validating path...</p>
                )}
                <p className="mt-1 text-xs text-white/50">
                    Screenshots will be saved in subfolders named after each recording
                </p>
            </div>

            <div className="flex items-center justify-between">
                <div className="pr-4">
                    <label className="block text-sm font-medium text-white/80">
                        Send Screenshots to AI
                    </label>
                    <p className="text-xs text-white/50 mt-1">
                        When disabled, AI receives OCR text and metadata only (no images)
                    </p>
                </div>
                <button
                    aria-label={`Send screenshots to AI: ${sendScreenshotsToAi ? 'enabled' : 'disabled'}`}
                    onClick={() => setSendScreenshotsToAi(!sendScreenshotsToAi)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                        sendScreenshotsToAi ? 'bg-[#2721E8]' : 'bg-white/20'
                    }`}
                >
                    <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            sendScreenshotsToAi ? 'translate-x-6' : 'translate-x-1'
                        }`}
                    />
                </button>
            </div>

            <div className="border-t border-white/8 pt-6">
                <label className="block text-sm font-medium text-white/80 mb-2">
                    Application Logs
                </label>
                <div className="flex items-center gap-2">
                    <button
                        onClick={async () => {
                            try {
                                const dir = await invoke<string>("ensure_logs_dir");
                                const { openPath } = await import("@tauri-apps/plugin-opener");
                                await openPath(dir);
                            } catch (err) {
                                console.error("Failed to open logs folder", err);
                            }
                        }}
                        className="px-3 py-2 bg-white/10 border border-white/10 rounded-md hover:bg-white/15 transition-colors text-sm text-white inline-flex items-center gap-2"
                    >
                        <FileText size={14} />
                        Open logs folder
                    </button>
                </div>
                <p className="mt-1 text-xs text-white/50">
                    Logs are split per category (ai, recorder, database, etc.) and rotated daily. Files older than 30 days are deleted automatically.
                </p>
            </div>
        </div>
    );
}
