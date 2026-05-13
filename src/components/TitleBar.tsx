import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
    Coffee,
    Settings as SettingsIcon,
    Info,
    FileText,
    Minus,
    Square,
    X,
    Copy,
} from "lucide-react";

import AboutModal from "./AboutModal";
import ChangelogModal from "./ChangelogModal";
import Tooltip from "./Tooltip";
import NotificationBell from "./notifications/NotificationBell";
import { useSettingsPanelStore } from "../store/settingsPanelStore";
import logoUrl from "/logo.png";

export default function TitleBar() {
    const openSettingsPanel = useSettingsPanelStore((s) => s.openPanel);
    const [isMaximized, setIsMaximized] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [showAbout, setShowAbout] = useState(false);
    const [showChangelog, setShowChangelog] = useState(false);
    const [version, setVersion] = useState("");
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        getVersion().then(setVersion).catch(console.error);
    }, []);

    useEffect(() => {
        const w = getCurrentWindow();
        let unlisten: (() => void) | undefined;
        let cancelled = false;

        w.isMaximized().then((v) => {
            if (!cancelled) setIsMaximized(v);
        });
        w.onResized(() => {
            w.isMaximized().then((v) => {
                if (!cancelled) setIsMaximized(v);
            });
        }).then((fn) => {
            if (cancelled) fn();
            else unlisten = fn;
        });

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, []);

    useEffect(() => {
        if (!menuOpen) return;
        const handle = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handle);
        return () => document.removeEventListener("mousedown", handle);
    }, [menuOpen]);

    const minimize = () => {
        getCurrentWindow().minimize().catch(console.error);
    };
    const toggleMaximize = () => {
        getCurrentWindow().toggleMaximize().catch(console.error);
    };
    const close = () => {
        getCurrentWindow().close().catch(console.error);
    };

    return (
        <>
            <div
                data-tauri-drag-region
                className="glass-surface-1 relative z-50 flex h-9 flex-shrink-0 items-center justify-between border-b border-white/8 pr-0 pl-3 select-none"
            >
                {/* Left: logo + title (drag region) */}
                <div
                    data-tauri-drag-region
                    className="flex min-w-0 flex-1 items-center gap-2"
                >
                    <img
                        src={logoUrl}
                        alt=""
                        className="h-4 w-4 flex-shrink-0"
                        draggable={false}
                    />
                    <span
                        data-tauri-drag-region
                        className="truncate text-xs font-medium text-white/80"
                    >
                        StepSnap
                    </span>
                </div>

                {/* Right: utility icons + window controls */}
                <div className="flex flex-shrink-0 items-center">
                    <Tooltip content="Buy me a coffee" position="bottom">
                        <div className="flex h-9 w-9 items-center justify-center">
                            <button
                                onClick={() => {
                                    openUrl("https://buymeacoffee.com/Pimzino").catch(console.error);
                                }}
                                aria-label="Buy me a coffee"
                                className="rounded-md p-1.5 text-amber-400 transition-colors hover:bg-white/10 hover:text-amber-300"
                            >
                                <Coffee size={15} />
                            </button>
                        </div>
                    </Tooltip>

                    <Tooltip content="Notifications" position="bottom">
                        <div className="flex h-9 w-9 items-center justify-center">
                            <NotificationBell />
                        </div>
                    </Tooltip>

                    <div ref={menuRef} className="relative">
                        <Tooltip content="Menu" position="bottom">
                            <div className="flex h-9 w-9 items-center justify-center">
                                <button
                                    onClick={() => setMenuOpen((v) => !v)}
                                    aria-label="App menu"
                                    aria-expanded={menuOpen}
                                    className={`rounded-md p-1.5 transition-colors hover:bg-white/10 ${
                                        menuOpen ? "bg-white/10 text-white" : "text-white/70 hover:text-white"
                                    }`}
                                >
                                    <SettingsIcon size={15} />
                                </button>
                            </div>
                        </Tooltip>
                        {menuOpen && (
                            <div className="glass-surface-3 animate-tray-in absolute right-0 top-full mt-1 w-52 overflow-hidden rounded-lg shadow-xl">
                                <button
                                    onClick={() => {
                                        setMenuOpen(false);
                                        openSettingsPanel();
                                    }}
                                    className="flex w-full items-center gap-3 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                                >
                                    <SettingsIcon size={14} />
                                    Settings
                                </button>
                                <button
                                    onClick={() => {
                                        setMenuOpen(false);
                                        setShowAbout(true);
                                    }}
                                    className="flex w-full items-center gap-3 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                                >
                                    <Info size={14} />
                                    About
                                </button>
                                <button
                                    onClick={() => {
                                        setMenuOpen(false);
                                        setShowChangelog(true);
                                    }}
                                    className="flex w-full items-center justify-between gap-3 border-t border-white/8 px-3 py-2 text-sm text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                                >
                                    <span className="flex items-center gap-3">
                                        <FileText size={14} />
                                        What's new
                                    </span>
                                    {version && (
                                        <span className="text-xs text-white/40">v{version}</span>
                                    )}
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="mx-1 h-4 w-px bg-white/10" />

                    <Tooltip content="Minimize" position="bottom">
                        <button
                            onClick={minimize}
                            aria-label="Minimize"
                            className="flex h-9 w-11 items-center justify-center text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <Minus size={15} />
                        </button>
                    </Tooltip>
                    <Tooltip content={isMaximized ? "Restore" : "Maximize"} position="bottom">
                        <button
                            onClick={toggleMaximize}
                            aria-label={isMaximized ? "Restore" : "Maximize"}
                            className="flex h-9 w-11 items-center justify-center text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            {isMaximized ? <Copy size={13} className="rotate-90" /> : <Square size={12} />}
                        </button>
                    </Tooltip>
                    <Tooltip content="Close" position="bottom">
                        <button
                            onClick={close}
                            aria-label="Close"
                            className="flex h-9 w-11 items-center justify-center text-white/70 transition-colors hover:bg-red-600 hover:text-white"
                        >
                            <X size={15} />
                        </button>
                    </Tooltip>
                </div>
            </div>

            <AboutModal isOpen={showAbout} onClose={() => setShowAbout(false)} />
            <ChangelogModal isOpen={showChangelog} onClose={() => setShowChangelog(false)} />
        </>
    );
}
