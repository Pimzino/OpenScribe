import { useState, useEffect } from "react";
import { X, RefreshCw, FileText } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ChangelogModal from "./ChangelogModal";
import UpdateChangelogModal from "./UpdateChangelogModal";
import { useUpdateStore } from "../store/updateStore";

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
    const [version, setVersion] = useState("");
    const [showChangelog, setShowChangelog] = useState(false);
    const [showUpdateChangelog, setShowUpdateChangelog] = useState(false);
    const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
    const [updateMessage, setUpdateMessage] = useState<string | null>(null);
    const { checkForUpdates, updateAvailable, updateInfo } = useUpdateStore();

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
                setUpdateMessage("Update available!");
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
                    aria-label="Close modal"
                >
                    <X size={16} />
                </button>

                <div className="flex items-center gap-3 mb-4">
                    <img src="/logo.png" alt="StepSnap" className="w-12 h-12" />
                    <div>
                        <h2 className="text-xl font-bold">StepSnap</h2>
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
                    <div className="mt-2">
                        <p className={`text-xs ${updateAvailable ? "text-[#49B8D3]" : "text-white/50"}`}>
                            {updateMessage}
                        </p>
                        {updateAvailable && updateInfo?.body && (
                            <button
                                onClick={() => setShowUpdateChangelog(true)}
                                className="flex items-center gap-1 text-xs text-[#49B8D3] hover:text-[#5ec8e3] mt-1 transition-colors"
                            >
                                <FileText size={12} />
                                <span>View Changes in v{updateInfo.version}</span>
                            </button>
                        )}
                    </div>
                )}
            </div>

            <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
            <UpdateChangelogModal isOpen={showUpdateChangelog} onClose={() => setShowUpdateChangelog(false)} />
        </div>
    );
}
