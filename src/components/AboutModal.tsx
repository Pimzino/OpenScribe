import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import ChangelogModal from "./ChangelogModal";

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
    const [version, setVersion] = useState("");
    const [showChangelog, setShowChangelog] = useState(false);

    useEffect(() => {
        if (isOpen && !version) {
            getVersion().then(setVersion).catch(console.error);
        }
    }, [isOpen, version]);

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

                <p className="text-sm text-white/70">
                    AI-powered documentation generator that captures your screen interactions and creates step-by-step guides automatically.
                </p>
            </div>

            <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
        </div>
    );
}
