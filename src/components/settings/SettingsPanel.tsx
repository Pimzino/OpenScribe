import { useEffect, useState, type ComponentType } from "react";
import {
    FolderOpen,
    Sparkles,
    Wand2,
    ShieldCheck,
    Keyboard,
    X,
    type LucideIcon,
} from "lucide-react";
import { useSettingsPanelStore } from "../../store/settingsPanelStore";
import { useSettingsStore } from "../../store/settingsStore";
import Tooltip from "../Tooltip";
import GeneralSection from "./GeneralSection";
import AiProviderSection from "./AiProviderSection";
import GenerationSection from "./GenerationSection";
import ReliabilitySection from "./ReliabilitySection";
import ShortcutsSection from "./ShortcutsSection";

type SectionId = "general" | "ai" | "generation" | "reliability" | "shortcuts";

interface SectionDef {
    id: SectionId;
    label: string;
    icon: LucideIcon;
    Component: ComponentType;
}

const SECTIONS: SectionDef[] = [
    { id: "general", label: "General", icon: FolderOpen, Component: GeneralSection },
    { id: "ai", label: "AI Provider", icon: Sparkles, Component: AiProviderSection },
    { id: "generation", label: "Generation", icon: Wand2, Component: GenerationSection },
    { id: "reliability", label: "Reliability", icon: ShieldCheck, Component: ReliabilitySection },
    { id: "shortcuts", label: "Shortcuts", icon: Keyboard, Component: ShortcutsSection },
];

export default function SettingsPanel() {
    const panelOpen = useSettingsPanelStore((s) => s.panelOpen);
    const closePanel = useSettingsPanelStore((s) => s.closePanel);
    const isLoaded = useSettingsStore((s) => s.isLoaded);
    const loadSettings = useSettingsStore((s) => s.loadSettings);
    const [activeSection, setActiveSection] = useState<SectionId>("general");

    // Always open to General — reset when panel transitions to open.
    useEffect(() => {
        if (panelOpen) {
            setActiveSection("general");
        }
    }, [panelOpen]);

    // Ensure settings are hydrated if user opens the panel before App's effect finishes.
    useEffect(() => {
        if (panelOpen && !isLoaded) {
            loadSettings();
        }
    }, [panelOpen, isLoaded, loadSettings]);

    // Close on Escape
    useEffect(() => {
        if (!panelOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                closePanel();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [panelOpen, closePanel]);

    if (!panelOpen) return null;

    const ActiveComponent = SECTIONS.find((s) => s.id === activeSection)!.Component;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[9990] bg-black/30"
                onClick={closePanel}
            />

            {/* Panel */}
            <div
                role="dialog"
                aria-label="Settings"
                className="glass-surface-2 animate-tray-slide-in fixed bottom-3 right-3 top-12 z-[9991] flex w-[min(760px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-xl border border-white/10 text-white shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/8 flex-shrink-0">
                    <h2 className="text-base font-semibold text-white">Settings</h2>
                    <Tooltip content="Close">
                        <button
                            onClick={closePanel}
                            aria-label="Close settings"
                            className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                        >
                            <X size={16} />
                        </button>
                    </Tooltip>
                </div>

                {/* Body: icon rail + active section */}
                <div className="flex min-h-0 flex-1">
                    {/* Icon rail */}
                    <nav
                        className="flex w-14 flex-shrink-0 flex-col gap-1 border-r border-white/8 p-2"
                        aria-label="Settings sections"
                    >
                        {SECTIONS.map(({ id, label, icon: Icon }) => {
                            const isActive = activeSection === id;
                            return (
                                <Tooltip key={id} content={label} position="right">
                                    <button
                                        onClick={() => setActiveSection(id)}
                                        aria-label={label}
                                        aria-current={isActive ? "page" : undefined}
                                        className={`relative flex h-10 w-10 items-center justify-center rounded-md transition-colors ${
                                            isActive
                                                ? "bg-[#2721E8]/20 text-white"
                                                : "text-white/60 hover:bg-white/10 hover:text-white"
                                        }`}
                                    >
                                        {isActive && (
                                            <span
                                                aria-hidden="true"
                                                className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r bg-[#2721E8]"
                                            />
                                        )}
                                        <Icon size={16} />
                                    </button>
                                </Tooltip>
                            );
                        })}
                    </nav>

                    {/* Content */}
                    <div className="scroll-container flex-1 overflow-y-auto overflow-x-hidden p-6">
                        <ActiveComponent />
                    </div>
                </div>
            </div>
        </>
    );
}
