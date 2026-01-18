import { useState, useEffect } from "react";
import { X, RefreshCw } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ChangelogModal from "./ChangelogModal";
import { useUpdateStore } from "../store/updateStore";

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
    const [version, setVersion] = useState("");
    const [showChangelog, setShowChangelog] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateMessage, setUpdateMessage] = useState<string | null>(null);
    const { checkForUpdates, updateAvailable } = useUpdateStore();

    useEffect(() => {
        if (isOpen && !version) {
            getVersion().then(setVersion).catch(console.error);
        }
    }, [isOpen, version]);

    const handleCheckForUpdates = async () => {
        setIsCheckingUpdate(true);
        setUpdateMessage(null);

        try {
            const hasUpdate = await checkForUpdates();
            if (hasUpdate) {
                setUpdateMessage("Update available! Check the notification.");
                onClose();
            } else {
                setUpdateMessage("You're running the latest version.");
            }
        } catch {
            setUpdateMessage("Failed to check for updates.");
        } finally {
            setIsCheckingUpdate(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-surface-2 rounded-2xl shadow-2xl p-6 w-96 relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                    <X size={16} />
                </button>

                <div className="flex items-center gap-3 mb-4">
                    <img src="/logo.png" alt="OpenScribe" className="w-12 h-12" />
                    <div>
                        <h2 className="text-xl font-bold">OpenScribe</h2>
                        <button
                            onClick={() => setShowChangelog(true)}
                            className="text-sm text-white/50 hover:text-white/70 transition-colors"
                        >
                            v{version || "..."}
                        </button>
                    </div>
                </div>

                <p className="text-sm text-white/70 mb-4">
                    AI-powered documentation generator that captures your screen interactions and creates step-by-step guides automatically.
                </p>

                <button
                    onClick={handleCheckForUpdates}
                    disabled={isCheckingUpdate}
                    className="flex items-center justify-center gap-2 w-full px-3 py-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed text-white/80 text-sm rounded-lg transition-colors border border-white/10"
                >
                    <RefreshCw size={14} className={isCheckingUpdate ? "animate-spin" : ""} />
                    <span>{isCheckingUpdate ? "Checking..." : "Check for Updates"}</span>
                </button>

                {updateMessage && (
                    <p className={`text-xs mt-2 ${updateAvailable ? "text-[#49B8D3]" : "text-white/50"}`}>
                        {updateMessage}
                    </p>
                )}
            </div>

            <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
        </div>
    );
}
