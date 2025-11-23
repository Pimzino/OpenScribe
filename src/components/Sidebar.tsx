import { useState } from "react";
import { FileText, TrendingUp, List, Settings, Info } from "lucide-react";
import AboutModal from "./AboutModal";

type Page = "dashboard" | "recordings" | "settings" | "new-recording" | "recording-detail";

interface SidebarProps {
    activePage: Page;
    onNavigate: (page: "dashboard" | "recordings" | "settings") => void;
}

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
    const [showAbout, setShowAbout] = useState(false);

    return (
        <>
            <aside className="w-64 border-r border-zinc-800 p-4 flex flex-col h-full">
                <h1 className="text-xl font-bold mb-8 flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <FileText size={18} />
                    </div>
                    OpenScribe
                </h1>

                <nav className="space-y-2 flex-1">
                    <button
                        onClick={() => onNavigate("dashboard")}
                        className={`w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors ${
                            activePage === "dashboard" ? "bg-zinc-900 text-white" : "text-zinc-400"
                        }`}
                    >
                        <TrendingUp size={16} />
                        Dashboard
                    </button>
                    <button
                        onClick={() => onNavigate("recordings")}
                        className={`w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors ${
                            activePage === "recordings" || activePage === "new-recording" || activePage === "recording-detail"
                                ? "bg-zinc-900 text-white"
                                : "text-zinc-400"
                        }`}
                    >
                        <List size={16} />
                        My Recordings
                    </button>
                    <button
                        onClick={() => onNavigate("settings")}
                        className={`w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors ${
                            activePage === "settings" ? "bg-zinc-900 text-white" : "text-zinc-400"
                        }`}
                    >
                        <Settings size={16} />
                        Settings
                    </button>
                </nav>

                <div className="border-t border-zinc-800 pt-4 mt-4">
                    <button
                        onClick={() => setShowAbout(true)}
                        className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors text-zinc-400"
                    >
                        <Info size={16} />
                        About
                    </button>
                    <p className="text-xs text-zinc-600 text-center mt-2">v0.1.0</p>
                </div>
            </aside>

            <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
        </>
    );
}
