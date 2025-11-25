import { X } from "lucide-react";

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function AboutModal({ isOpen, onClose }: AboutModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-96 relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1 hover:bg-zinc-800 rounded-md transition-colors"
                >
                    <X size={16} />
                </button>

                <div className="flex items-center gap-3 mb-4">
                    <img src="/logo.png" alt="OpenScribe" className="w-12 h-12" />
                    <div>
                        <h2 className="text-xl font-bold">OpenScribe</h2>
                        <p className="text-sm text-zinc-500">v0.1.0</p>
                    </div>
                </div>

                <p className="text-sm text-zinc-300">
                    AI-powered documentation generator that captures your screen interactions and creates step-by-step guides automatically.
                </p>
            </div>
        </div>
    );
}
