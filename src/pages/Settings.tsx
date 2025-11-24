import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore, HotkeyBinding } from "../store/settingsStore";
import { Save, Eye, EyeOff, FolderOpen, RotateCcw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "../components/Sidebar";
import Spinner from "../components/Spinner";
import Tooltip from "../components/Tooltip";

export default function Settings() {
    const navigate = useNavigate();
    const {
        openaiBaseUrl,
        openaiApiKey,
        openaiModel,
        screenshotPath,
        startRecordingHotkey,
        stopRecordingHotkey,
        captureHotkey,
        setOpenaiBaseUrl,
        setOpenaiApiKey,
        setOpenaiModel,
        setScreenshotPath,
        setStartRecordingHotkey,
        setStopRecordingHotkey,
        setCaptureHotkey,
        saveSettings,
        loadSettings,
        isLoaded,
        getDefaultScreenshotPath,
    } = useSettingsStore();

    const [showApiKey, setShowApiKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [capturingHotkey, setCapturingHotkey] = useState<"start" | "stop" | "capture" | null>(null);
    const [pathError, setPathError] = useState<string | null>(null);
    const [validatingPath, setValidatingPath] = useState(false);
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);

    const validateApiKey = (key: string): string | null => {
        if (!key) return null;
        if (!key.startsWith("sk-")) return "API key must start with 'sk-'";
        if (key.length < 20) return "API key must be at least 20 characters";
        return null;
    };

    const areHotkeysEqual = (a: HotkeyBinding, b: HotkeyBinding): boolean => {
        return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
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

    const formatHotkey = (hotkey: HotkeyBinding): string => {
        const parts: string[] = [];
        if (hotkey.ctrl) parts.push("Ctrl");
        if (hotkey.shift) parts.push("Shift");
        if (hotkey.alt) parts.push("Alt");
        // Convert KeyR to R, KeyS to S, etc.
        const keyName = hotkey.key.replace("Key", "").replace("Digit", "");
        parts.push(keyName);
        return parts.join(" + ");
    };

    const handleHotkeyCapture = (e: React.KeyboardEvent, type: "start" | "stop" | "capture") => {
        e.preventDefault();
        if (e.key === "Escape") {
            setCapturingHotkey(null);
            return;
        }
        // Ignore modifier-only keys
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
            return;
        }
        const hotkey: HotkeyBinding = {
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            key: e.code,
        };
        if (type === "start") {
            setStartRecordingHotkey(hotkey);
        } else if (type === "stop") {
            setStopRecordingHotkey(hotkey);
        } else {
            setCaptureHotkey(hotkey);
        }
        setCapturingHotkey(null);
    };

    const getHotkeyWarning = (hotkey: HotkeyBinding): string | null => {
        const key = hotkey.key;

        // Problematic Ctrl+Shift combinations (browser shortcuts)
        if (hotkey.ctrl && hotkey.shift && !hotkey.alt) {
            if (key === "KeyR") return "Conflicts with browser hard reload";
            if (key === "KeyI") return "Conflicts with browser dev tools";
            if (key === "KeyJ") return "Conflicts with browser downloads";
            if (key === "KeyN") return "Conflicts with incognito window";
        }

        // Problematic Ctrl combinations
        if (hotkey.ctrl && !hotkey.shift && !hotkey.alt) {
            if (key === "KeyW") return "Conflicts with close tab";
            if (key === "KeyT") return "Conflicts with new tab";
            if (key === "KeyN") return "Conflicts with new window";
            if (key === "KeyQ") return "Conflicts with quit application";
        }

        // Problematic Alt combinations
        if (hotkey.alt && !hotkey.ctrl && !hotkey.shift) {
            if (key === "F4") return "Conflicts with close window";
        }

        // Require at least one modifier
        if (!hotkey.ctrl && !hotkey.shift && !hotkey.alt) {
            return "Hotkey should include at least one modifier (Ctrl, Shift, or Alt)";
        }

        return null;
    };

    const startWarning = getHotkeyWarning(startRecordingHotkey);
    const stopWarning = getHotkeyWarning(stopRecordingHotkey);
    const captureWarning = getHotkeyWarning(captureHotkey);
    const hotkeysMatch = areHotkeysEqual(startRecordingHotkey, stopRecordingHotkey) ||
        areHotkeysEqual(startRecordingHotkey, captureHotkey) ||
        areHotkeysEqual(stopRecordingHotkey, captureHotkey);

    useEffect(() => {
        if (!isLoaded) {
            loadSettings();
        }
    }, [isLoaded, loadSettings]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveSettings();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error("Failed to save settings:", error);
        } finally {
            setSaving(false);
        }
    };

    const handleNavigate = (page: "dashboard" | "recordings" | "settings") => {
        if (page === "dashboard") navigate("/");
        else if (page === "recordings") navigate("/recordings");
    };

    return (
        <div className="flex h-screen bg-zinc-950 text-white">
            <Sidebar activePage="settings" onNavigate={handleNavigate} />

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="max-w-2xl">
                    <h2 className="text-2xl font-bold mb-8">Settings</h2>

                    <div className="space-y-6">
                        {/* Storage Section */}
                        <div>
                            <h3 className="text-lg font-medium text-zinc-200 mb-4">Storage</h3>

                            {/* Screenshot Path */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-300 mb-2">
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
                                        className={`flex-1 px-4 py-2 bg-zinc-900 border rounded-md text-white placeholder-zinc-500 focus:outline-none transition-colors ${
                                            pathError
                                                ? "border-red-600 focus:border-red-500"
                                                : "border-zinc-800 focus:border-blue-600"
                                        }`}
                                    />
                                    <Tooltip content="Browse for folder" position="top">
                                        <button
                                            onClick={handleBrowseFolder}
                                            className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md hover:bg-zinc-700 transition-colors"
                                        >
                                            <FolderOpen size={16} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip content="Reset to default" position="top">
                                        <button
                                            onClick={handleResetPath}
                                            className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md hover:bg-zinc-700 transition-colors"
                                        >
                                            <RotateCcw size={16} />
                                        </button>
                                    </Tooltip>
                                </div>
                                {pathError && (
                                    <p className="mt-1 text-xs text-red-500">{pathError}</p>
                                )}
                                {validatingPath && (
                                    <p className="mt-1 text-xs text-zinc-500">Validating path...</p>
                                )}
                                <p className="mt-1 text-xs text-zinc-500">
                                    Screenshots will be saved in subfolders named after each recording
                                </p>
                            </div>
                        </div>

                        {/* AI Section */}
                        <div className="border-t border-zinc-800 pt-6">
                            <h3 className="text-lg font-medium text-zinc-200 mb-4">AI</h3>
                        </div>

                        {/* OpenAI Base URL */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">
                                OpenAI Base URL
                            </label>
                            <input
                                type="url"
                                value={openaiBaseUrl}
                                onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                                placeholder="https://api.openai.com/v1"
                                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-blue-600 transition-colors"
                            />
                            <p className="mt-1 text-xs text-zinc-500">
                                Use a custom base URL for OpenAI-compatible APIs (e.g., Azure, local models)
                            </p>
                        </div>

                        {/* Model ID */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">
                                Model ID
                            </label>
                            <input
                                type="text"
                                value={openaiModel}
                                onChange={(e) => setOpenaiModel(e.target.value)}
                                placeholder=""
                                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-blue-600 transition-colors"
                            />
                            <p className="mt-1 text-xs text-zinc-500">
                                Model to use for generation
                            </p>
                        </div>

                        {/* API Key */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">
                                API Key
                            </label>
                            <div className="relative">
                                <input
                                    type={showApiKey ? "text" : "password"}
                                    value={openaiApiKey}
                                    onChange={(e) => {
                                        setOpenaiApiKey(e.target.value);
                                        setApiKeyError(validateApiKey(e.target.value));
                                    }}
                                    placeholder="sk-..."
                                    className={`w-full px-4 py-2 pr-10 bg-zinc-900 border rounded-md text-white placeholder-zinc-500 focus:outline-none transition-colors ${
                                        apiKeyError
                                            ? "border-red-600 focus:border-red-500"
                                            : "border-zinc-800 focus:border-blue-600"
                                    }`}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                                >
                                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            {apiKeyError && (
                                <p className="mt-1 text-xs text-red-500">{apiKeyError}</p>
                            )}
                            <p className="mt-1 text-xs text-zinc-500">
                                Your API key is stored securely on your device
                            </p>
                        </div>

                        {/* Hotkeys Section */}
                        <div className="border-t border-zinc-800 pt-6 mt-6">
                            <h3 className="text-lg font-medium text-zinc-200 mb-4">Keyboard Shortcuts</h3>

                            {/* Start Recording Hotkey */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-zinc-300 mb-2">
                                    Start Recording
                                </label>
                                <button
                                    onClick={() => setCapturingHotkey("start")}
                                    onKeyDown={(e) => capturingHotkey === "start" && handleHotkeyCapture(e, "start")}
                                    className={`w-full px-4 py-2 bg-zinc-900 border rounded-md text-left font-mono text-sm transition-colors ${
                                        capturingHotkey === "start"
                                            ? "border-blue-600 text-blue-400"
                                            : startWarning
                                            ? "border-yellow-600 text-white hover:border-yellow-500"
                                            : "border-zinc-800 text-white hover:border-zinc-700"
                                    }`}
                                >
                                    {capturingHotkey === "start" ? "Press keys..." : formatHotkey(startRecordingHotkey)}
                                </button>
                                {startWarning && (
                                    <p className="mt-1 text-xs text-yellow-500">{startWarning}</p>
                                )}
                            </div>

                            {/* Stop Recording Hotkey */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-zinc-300 mb-2">
                                    Stop Recording
                                </label>
                                <button
                                    onClick={() => setCapturingHotkey("stop")}
                                    onKeyDown={(e) => capturingHotkey === "stop" && handleHotkeyCapture(e, "stop")}
                                    className={`w-full px-4 py-2 bg-zinc-900 border rounded-md text-left font-mono text-sm transition-colors ${
                                        capturingHotkey === "stop"
                                            ? "border-blue-600 text-blue-400"
                                            : stopWarning
                                            ? "border-yellow-600 text-white hover:border-yellow-500"
                                            : "border-zinc-800 text-white hover:border-zinc-700"
                                    }`}
                                >
                                    {capturingHotkey === "stop" ? "Press keys..." : formatHotkey(stopRecordingHotkey)}
                                </button>
                                {stopWarning && (
                                    <p className="mt-1 text-xs text-yellow-500">{stopWarning}</p>
                                )}
                            </div>

                            {/* Manual Capture Hotkey */}
                            <div>
                                <label className="block text-sm font-medium text-zinc-300 mb-2">
                                    Manual Capture (Screenshot)
                                </label>
                                <button
                                    onClick={() => setCapturingHotkey("capture")}
                                    onKeyDown={(e) => capturingHotkey === "capture" && handleHotkeyCapture(e, "capture")}
                                    className={`w-full px-4 py-2 bg-zinc-900 border rounded-md text-left font-mono text-sm transition-colors ${
                                        capturingHotkey === "capture"
                                            ? "border-blue-600 text-blue-400"
                                            : captureWarning
                                            ? "border-yellow-600 text-white hover:border-yellow-500"
                                            : "border-zinc-800 text-white hover:border-zinc-700"
                                    }`}
                                >
                                    {capturingHotkey === "capture" ? "Press keys..." : formatHotkey(captureHotkey)}
                                </button>
                                {captureWarning && (
                                    <p className="mt-1 text-xs text-yellow-500">{captureWarning}</p>
                                )}
                            </div>
                            {hotkeysMatch && (
                                <p className="mt-2 text-xs text-red-500">
                                    Hotkeys cannot be the same
                                </p>
                            )}
                            <p className="mt-2 text-xs text-zinc-500">
                                Click on a field and press your desired key combination
                            </p>
                        </div>

                        {/* Save Button */}
                        <div className="pt-4">
                            <button
                                onClick={handleSave}
                                disabled={saving || !!apiKeyError || hotkeysMatch}
                                className={`flex items-center gap-2 px-6 py-2 rounded-md font-medium transition-colors ${
                                    saved
                                        ? "bg-green-600 hover:bg-green-700"
                                        : "bg-blue-600 hover:bg-blue-700"
                                } ${saving || !!apiKeyError || hotkeysMatch ? "opacity-50 cursor-not-allowed" : ""}`}
                            >
                                {saving ? <Spinner size="sm" /> : <Save size={16} />}
                                {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
