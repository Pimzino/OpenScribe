import { useState, useEffect } from "react";
import { TrendingUp, List, Settings, Info, Coffee } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getVersion } from "@tauri-apps/api/app";
import AboutModal from "./AboutModal";
import ChangelogModal from "./ChangelogModal";

type Page = "dashboard" | "recordings" | "settings" | "new-recording" | "recording-detail";

interface SidebarProps {
    activePage: Page;
    onNavigate: (page: "dashboard" | "recordings" | "settings") => void;
}

export default function Sidebar({ activePage, onNavigate }: SidebarProps) {
    const [showAbout, setShowAbout] = useState(false);
    const [showChangelog, setShowChangelog] = useState(false);
    const [version, setVersion] = useState("");

    useEffect(() => {
        getVersion().then(setVersion).catch(console.error);
    }, []);

    return (
        <>
            <aside className="w-64 border-r border-zinc-800 p-4 flex flex-col h-full">
                <h1 className="text-xl font-bold mb-8 flex items-center gap-2">
                    <img src="/logo.png" alt="OpenScribe" className="w-8 h-8" />
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
                        onClick={() => {
                            openUrl("https://buymeacoffee.com/Pimzino").catch(console.error);
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium bg-amber-500 hover:bg-amber-400 transition-colors text-zinc-900 mb-2"
                    >
                        <Coffee size={16} />
                        Buy me a coffee
                    </button>
                    <button
                        onClick={() => setShowAbout(true)}
                        className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors text-zinc-400"
                    >
                        <Info size={16} />
                        About
                    </button>
                    <button
                        onClick={() => setShowChangelog(true)}
                        className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors text-center mt-2 w-full"
                    >
                        v{version}
                    </button>
                </div>
            </aside>

            <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
            <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
        </>
    );
}
