import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecorderStore } from "../../store/recorderStore";
import { Square } from "lucide-react";
import Tooltip from "../../components/Tooltip";

export default function RecorderOverlay() {
    const { isRecording, setIsRecording } = useRecorderStore();
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        // In a real app, we would use a separate window for the overlay
        // For now, we simulate it or just show it if recording
        setIsVisible(isRecording);
    }, [isRecording]);

    const stopRecording = async () => {
        try {
            await invoke("stop_recording");
            setIsRecording(false);
        } catch (error) {
            console.error("Failed to stop recording:", error);
        }
    };

    if (!isVisible) return null;

    return (
        <div className="fixed bottom-4 right-4 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-4 flex items-center gap-4 z-50 animate-in slide-in-from-bottom-2">
            <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                <span className="text-white font-medium text-sm">Recording...</span>
            </div>
            <Tooltip content="Stop Recording">
                <button
                    onClick={stopRecording}
                    className="p-2 bg-red-600 hover:bg-red-700 rounded-md text-white transition-colors"
                >
                    <Square size={16} />
                </button>
            </Tooltip>
        </div>
    );
}
