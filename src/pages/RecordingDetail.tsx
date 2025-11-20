import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useRecordingsStore } from "../store/recordingsStore";
import { generateDocumentation } from "../lib/aiService";
import { useSettingsStore } from "../store/settingsStore";
import { FileText, ArrowLeft, Settings, Download, RefreshCw, List, TrendingUp, Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface RecordingDetailProps {
    recordingId: string;
    onBack: () => void;
    onEdit: () => void;
    onSettings: () => void;
}

export default function RecordingDetail({ recordingId, onBack, onSettings }: RecordingDetailProps) {
    const { currentRecording, getRecording, saveDocumentation, loading } = useRecordingsStore();
    const { openaiApiKey, openaiBaseUrl, openaiModel } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<"steps" | "docs">("docs");
    const [regenerating, setRegenerating] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        getRecording(recordingId);
    }, [recordingId, getRecording]);

    const handleRegenerate = async () => {
        if (!currentRecording || !openaiApiKey) return;

        setRegenerating(true);
        try {
            const steps = currentRecording.steps.map(step => ({
                type_: step.type_,
                x: step.x,
                y: step.y,
                text: step.text,
                timestamp: step.timestamp,
                screenshot: step.screenshot_path,
                element_name: step.element_name,
                element_type: step.element_type,
                element_value: step.element_value,
                app_name: step.app_name,
            }));

            const markdown = await generateDocumentation(steps, {
                apiKey: openaiApiKey,
                baseUrl: openaiBaseUrl,
                model: openaiModel,
            });

            await saveDocumentation(recordingId, markdown);
            await getRecording(recordingId);
        } catch (error) {
            console.error("Failed to regenerate documentation:", error);
        } finally {
            setRegenerating(false);
        }
    };

    const handleCopy = async () => {
        if (currentRecording?.recording.documentation) {
            await navigator.clipboard.writeText(currentRecording.recording.documentation);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleExportMarkdown = () => {
        if (!currentRecording?.recording.documentation) return;

        const blob = new Blob([currentRecording.recording.documentation], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentRecording.recording.name}.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportHtml = () => {
        if (!currentRecording?.recording.documentation) return;

        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${currentRecording.recording.name}</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; }
        img { max-width: 100%; height: auto; }
        pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; }
        code { background: #f4f4f4; padding: 0.2rem 0.4rem; }
    </style>
</head>
<body>
    <h1>${currentRecording.recording.name}</h1>
    ${currentRecording.recording.documentation}
</body>
</html>`;

        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentRecording.recording.name}.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (loading && !currentRecording) {
        return (
            <div className="flex h-screen bg-zinc-950 text-white items-center justify-center">
                <div className="text-zinc-500">Loading recording...</div>
            </div>
        );
    }

    if (!currentRecording) {
        return (
            <div className="flex h-screen bg-zinc-950 text-white items-center justify-center">
                <div className="text-zinc-500">Recording not found</div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-zinc-950 text-white">
            {/* Sidebar */}
            <aside className="w-64 border-r border-zinc-800 p-4">
                <h1 className="text-xl font-bold mb-8 flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <FileText size={18} />
                    </div>
                    OpenScribe
                </h1>

                <nav className="space-y-2">
                    <button
                        onClick={() => onBack()}
                        className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors text-zinc-400"
                    >
                        <TrendingUp size={16} />
                        Dashboard
                    </button>
                    <button
                        onClick={onBack}
                        className="w-full flex items-center gap-3 px-4 py-2 bg-zinc-900 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors"
                    >
                        <List size={16} />
                        My Recordings
                    </button>
                    <button
                        onClick={onSettings}
                        className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors text-zinc-400"
                    >
                        <Settings size={16} />
                        Settings
                    </button>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h2 className="text-2xl font-bold">{currentRecording.recording.name}</h2>
                            <p className="text-sm text-zinc-500">
                                {currentRecording.steps.length} steps • Created {new Date(currentRecording.recording.created_at).toLocaleDateString()}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {activeTab === "docs" && currentRecording.recording.documentation && (
                            <>
                                <button
                                    onClick={handleCopy}
                                    className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 rounded-md transition-colors"
                                    title="Copy markdown"
                                >
                                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                                </button>
                                <button
                                    onClick={handleExportMarkdown}
                                    className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 rounded-md transition-colors"
                                    title="Export as Markdown"
                                >
                                    <Download size={16} />
                                    MD
                                </button>
                                <button
                                    onClick={handleExportHtml}
                                    className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 rounded-md transition-colors"
                                    title="Export as HTML"
                                >
                                    <Download size={16} />
                                    HTML
                                </button>
                            </>
                        )}
                        <button
                            onClick={handleRegenerate}
                            disabled={regenerating || !openaiApiKey}
                            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-md font-medium transition-colors disabled:opacity-50"
                        >
                            <RefreshCw size={16} className={regenerating ? "animate-spin" : ""} />
                            {regenerating ? "Generating..." : "Regenerate"}
                        </button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-6 bg-zinc-900 p-1 rounded-lg w-fit">
                    <button
                        onClick={() => setActiveTab("docs")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            activeTab === "docs" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"
                        }`}
                    >
                        Documentation
                    </button>
                    <button
                        onClick={() => setActiveTab("steps")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                            activeTab === "steps" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"
                        }`}
                    >
                        Steps
                    </button>
                </div>

                {activeTab === "docs" ? (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                        {currentRecording.recording.documentation ? (
                            <div className="markdown-content">
                                <ReactMarkdown
                                    components={{
                                        h1: ({children}) => <h1 className="text-2xl font-bold mb-4 mt-6">{children}</h1>,
                                        h2: ({children}) => <h2 className="text-xl font-semibold mb-3 mt-5">{children}</h2>,
                                        h3: ({children}) => <h3 className="text-lg font-medium mb-2 mt-4">{children}</h3>,
                                        p: ({children}) => <p className="mb-4 text-zinc-300">{children}</p>,
                                        ul: ({children}) => <ul className="list-disc pl-6 mb-4">{children}</ul>,
                                        ol: ({children}) => <ol className="list-decimal pl-6 mb-4">{children}</ol>,
                                        li: ({children}) => <li className="mb-1">{children}</li>,
                                        code: ({children}) => <code className="bg-zinc-800 px-1 py-0.5 rounded text-sm">{children}</code>,
                                        pre: ({children}) => <pre className="bg-zinc-800 p-4 rounded mb-4 overflow-x-auto">{children}</pre>,
                                        img: ({src, alt}) => <img src={src} alt={alt} className="max-w-full rounded my-4" />,
                                    }}
                                >
                                    {currentRecording.recording.documentation}
                                </ReactMarkdown>
                            </div>
                        ) : (
                            <div className="text-center py-12 text-zinc-500">
                                <p>No documentation generated yet</p>
                                <button
                                    onClick={handleRegenerate}
                                    disabled={regenerating || !openaiApiKey}
                                    className="mt-4 text-purple-500 hover:text-purple-400 disabled:opacity-50"
                                >
                                    Generate documentation
                                </button>
                                {!openaiApiKey && (
                                    <p className="mt-2 text-sm text-red-500">
                                        Configure your API key in Settings first
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {currentRecording.steps.map((step, index) => (
                            <div key={step.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                                {step.screenshot_path && (
                                    <div className="aspect-video bg-zinc-950 relative">
                                        <img
                                            src={convertFileSrc(step.screenshot_path)}
                                            alt={`Step ${index + 1}`}
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute top-2 left-2 bg-black/50 px-2 py-1 rounded text-xs">
                                            {new Date(step.timestamp).toLocaleTimeString()}
                                        </div>
                                    </div>
                                )}
                                <div className="p-4">
                                    <h3 className="font-medium text-sm text-zinc-300">
                                        Step {index + 1} ({step.type_ === "click" ? "Click" : "Type"})
                                    </h3>
                                    {step.type_ === "click" ? (
                                        <p className="text-xs text-zinc-500 mt-1">
                                            Clicked at ({step.x}, {step.y})
                                        </p>
                                    ) : (
                                        <div className="mt-2 bg-zinc-950 p-2 rounded border border-zinc-800 font-mono text-xs text-blue-400 break-words">
                                            "{step.text}"
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
