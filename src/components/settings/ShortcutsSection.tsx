import { useState } from "react";
import { useSettingsStore, HotkeyBinding } from "../../store/settingsStore";

type HotkeyTarget = "start" | "stop" | "capture";

const formatHotkey = (hotkey: HotkeyBinding): string => {
    const parts: string[] = [];
    if (hotkey.ctrl) parts.push("Ctrl");
    if (hotkey.shift) parts.push("Shift");
    if (hotkey.alt) parts.push("Alt");
    const keyName = hotkey.key.replace("Key", "").replace("Digit", "");
    parts.push(keyName);
    return parts.join(" + ");
};

const areHotkeysEqual = (a: HotkeyBinding, b: HotkeyBinding): boolean => {
    return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
};

const getHotkeyWarning = (hotkey: HotkeyBinding): string | null => {
    const key = hotkey.key;

    if (hotkey.ctrl && hotkey.shift && !hotkey.alt) {
        if (key === "KeyR") return "Conflicts with browser hard reload";
        if (key === "KeyI") return "Conflicts with browser dev tools";
        if (key === "KeyJ") return "Conflicts with browser downloads";
        if (key === "KeyN") return "Conflicts with incognito window";
    }

    if (hotkey.ctrl && !hotkey.shift && !hotkey.alt) {
        if (key === "KeyW") return "Conflicts with close tab";
        if (key === "KeyT") return "Conflicts with new tab";
        if (key === "KeyN") return "Conflicts with new window";
        if (key === "KeyQ") return "Conflicts with quit application";
    }

    if (hotkey.alt && !hotkey.ctrl && !hotkey.shift) {
        if (key === "F4") return "Conflicts with close window";
    }

    if (!hotkey.ctrl && !hotkey.shift && !hotkey.alt) {
        return "Hotkey should include at least one modifier (Ctrl, Shift, or Alt)";
    }

    return null;
};

export default function ShortcutsSection() {
    const {
        startRecordingHotkey,
        stopRecordingHotkey,
        captureHotkey,
        setStartRecordingHotkey,
        setStopRecordingHotkey,
        setCaptureHotkey,
    } = useSettingsStore();

    const [capturingHotkey, setCapturingHotkey] = useState<HotkeyTarget | null>(null);

    const handleHotkeyCapture = (e: React.KeyboardEvent, type: HotkeyTarget) => {
        e.preventDefault();
        if (e.key === "Escape") {
            setCapturingHotkey(null);
            return;
        }
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

    const startWarning = getHotkeyWarning(startRecordingHotkey);
    const stopWarning = getHotkeyWarning(stopRecordingHotkey);
    const captureWarning = getHotkeyWarning(captureHotkey);
    const hotkeysMatch =
        areHotkeysEqual(startRecordingHotkey, stopRecordingHotkey) ||
        areHotkeysEqual(startRecordingHotkey, captureHotkey) ||
        areHotkeysEqual(stopRecordingHotkey, captureHotkey);

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-white mb-1">Keyboard Shortcuts</h3>
                <p className="text-xs text-white/50">Click on a field and press your desired key combination.</p>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-white/80 mb-2">
                        Start Recording
                    </label>
                    <button
                        onClick={() => setCapturingHotkey("start")}
                        onKeyDown={(e) => capturingHotkey === "start" && handleHotkeyCapture(e, "start")}
                        className={`w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-left font-mono text-sm transition-colors ${
                            capturingHotkey === "start"
                                ? "border-[#2721E8] text-[#49B8D3]"
                                : startWarning
                                ? "border-yellow-600 text-white hover:border-yellow-500"
                                : "border-white/10 text-white hover:border-white/20"
                        }`}
                    >
                        {capturingHotkey === "start" ? "Press keys..." : formatHotkey(startRecordingHotkey)}
                    </button>
                    {startWarning && (
                        <p className="mt-1 text-xs text-yellow-500">{startWarning}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-white/80 mb-2">
                        Stop Recording
                    </label>
                    <button
                        onClick={() => setCapturingHotkey("stop")}
                        onKeyDown={(e) => capturingHotkey === "stop" && handleHotkeyCapture(e, "stop")}
                        className={`w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-left font-mono text-sm transition-colors ${
                            capturingHotkey === "stop"
                                ? "border-[#2721E8] text-[#49B8D3]"
                                : stopWarning
                                ? "border-yellow-600 text-white hover:border-yellow-500"
                                : "border-white/10 text-white hover:border-white/20"
                        }`}
                    >
                        {capturingHotkey === "stop" ? "Press keys..." : formatHotkey(stopRecordingHotkey)}
                    </button>
                    {stopWarning && (
                        <p className="mt-1 text-xs text-yellow-500">{stopWarning}</p>
                    )}
                </div>

                <div>
                    <label className="block text-sm font-medium text-white/80 mb-2">
                        Manual Capture (Screenshot)
                    </label>
                    <button
                        onClick={() => setCapturingHotkey("capture")}
                        onKeyDown={(e) => capturingHotkey === "capture" && handleHotkeyCapture(e, "capture")}
                        className={`w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-left font-mono text-sm transition-colors ${
                            capturingHotkey === "capture"
                                ? "border-[#2721E8] text-[#49B8D3]"
                                : captureWarning
                                ? "border-yellow-600 text-white hover:border-yellow-500"
                                : "border-white/10 text-white hover:border-white/20"
                        }`}
                    >
                        {capturingHotkey === "capture" ? "Press keys..." : formatHotkey(captureHotkey)}
                    </button>
                    {captureWarning && (
                        <p className="mt-1 text-xs text-yellow-500">{captureWarning}</p>
                    )}
                </div>

                {hotkeysMatch && (
                    <p className="text-xs text-red-500">
                        Hotkeys cannot be the same
                    </p>
                )}
            </div>
        </div>
    );
}
