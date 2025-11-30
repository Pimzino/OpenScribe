import { X, Plus, RefreshCw, Wrench } from "lucide-react";
import { currentChangelog, ChangelogSection } from "../lib/changelog-data";

interface ChangelogModalProps {
    isOpen: boolean;
    onClose: () => void;
}

function getSectionIcon(title: string) {
    switch (title.toLowerCase()) {
        case "added":
            return <Plus size={14} className="text-emerald-400" />;
        case "changed":
            return <RefreshCw size={14} className="text-[#49B8D3]" />;
        case "fixed":
            return <Wrench size={14} className="text-[#FF6B35]" />;
        default:
            return null;
    }
}

function getSectionColor(title: string) {
    switch (title.toLowerCase()) {
        case "added":
            return "text-emerald-400";
        case "changed":
            return "text-[#49B8D3]";
        case "fixed":
            return "text-[#FF6B35]";
        default:
            return "text-zinc-400";
    }
}

function Section({ section }: { section: ChangelogSection }) {
    return (
        <div className="mb-4 last:mb-0">
            <h4 className={`text-sm font-semibold mb-2 flex items-center gap-2 ${getSectionColor(section.title)}`}>
                {getSectionIcon(section.title)}
                {section.title}
            </h4>
            <ul className="space-y-1.5">
                {section.items.map((item, index) => (
                    <li key={index} className="text-sm text-white/70 flex items-start gap-2">
                        <span className="mt-1.5 w-1 h-1 rounded-full bg-white/30 flex-shrink-0" />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export default function ChangelogModal({ isOpen, onClose }: ChangelogModalProps) {
    if (!isOpen) return null;

    const { version, date, sections } = currentChangelog;
    const hasContent = sections.length > 0;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-surface-2 rounded-2xl shadow-2xl p-6 w-[480px] max-h-[80vh] flex flex-col relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                    <X size={16} />
                </button>

                <div className="mb-4">
                    <h2 className="text-xl font-bold">What's New</h2>
                    <p className="text-sm text-white/50">
                        Version {version}
                        {date && <span className="ml-2">• {date}</span>}
                    </p>
                </div>

                <div className="overflow-y-auto flex-1 pr-2">
                    {hasContent ? (
                        sections.map((section, index) => (
                            <Section key={index} section={section} />
                        ))
                    ) : (
                        <p className="text-sm text-white/50">
                            No changelog available for this version.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
