import { useState, useEffect } from "react";
import { useRecorderStore } from "../store/recorderStore";
import { useRecordingsStore } from "../store/recordingsStore";
import { useSettingsStore } from "../store/settingsStore";
import { generateDocumentation } from "../lib/aiService";
import { ArrowLeft, Copy, Check, Download, Save, Edit3 } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface EditorProps {
    onBack: () => void;
    recordingId?: string | null;
}

export default function Editor({ onBack, recordingId }: EditorProps) {
    const { steps } = useRecorderStore();
    const { getRecording, saveDocumentation, currentRecording } = useRecordingsStore();
    const { openaiApiKey, openaiBaseUrl, openaiModel } = useSettingsStore();
    const [markdown, setMarkdown] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedMarkdown, setEditedMarkdown] = useState("");

    useEffect(() => {
        const generate = async () => {
            try {
                setError(null);

                // If we have a recordingId, use steps from the database
                if (recordingId) {
                    const recording = await getRecording(recordingId);
                    if (recording) {
                        const dbSteps = recording.steps.map(step => ({
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

                        const docs = await generateDocumentation(dbSteps, {
                            apiKey: openaiApiKey,
                            baseUrl: openaiBaseUrl,
                            model: openaiModel,
                        });
                        setMarkdown(docs);

                        // Save to database
                        await saveDocumentation(recordingId, docs);
                    }
                } else {
                    // Use steps from recorder store (new recording flow)
                    const docs = await generateDocumentation(steps, {
                        apiKey: openaiApiKey,
                        baseUrl: openaiBaseUrl,
                        model: openaiModel,
                    });
                    setMarkdown(docs);
                }
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to generate documentation");
            } finally {
                setLoading(false);
            }
        };
        generate();
    }, [recordingId, steps, getRecording, saveDocumentation, openaiApiKey, openaiBaseUrl, openaiModel]);

    const copyToClipboard = async () => {
        await navigator.clipboard.writeText(markdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleEdit = () => {
        setEditedMarkdown(markdown);
        setIsEditing(true);
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            setMarkdown(editedMarkdown);
            if (recordingId) {
                await saveDocumentation(recordingId, editedMarkdown);
            }
            setIsEditing(false);
        } catch (err) {
            console.error("Failed to save:", err);
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedMarkdown("");
    };

    const handleExportMarkdown = () => {
        const blob = new Blob([markdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `documentation.md`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportHtml = () => {
        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Documentation</title>
    <style>
        body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
        img { max-width: 100%; height: auto; }
        pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; border-radius: 4px; }
        code { background: #f4f4f4; padding: 0.2rem 0.4rem; border-radius: 2px; }
        h1, h2, h3 { margin-top: 1.5em; }
    </style>
</head>
<body>
${markdown}
</body>
</html>`;

        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `documentation.html`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex h-screen bg-zinc-950 text-white flex-col">
            <header className="border-b border-zinc-800 p-4 flex items-center justify-between bg-zinc-900">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <h1 className="text-lg font-bold">
                        {isEditing ? "Edit Documentation" : "Generated Documentation"}
                    </h1>
                </div>

                <div className="flex items-center gap-2">
                    {!loading && !error && !isEditing && (
                        <>
                            <button
                                onClick={handleEdit}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 rounded-md text-sm transition-colors"
                                title="Edit"
                            >
                                <Edit3 size={16} />
                            </button>
                            <button
                                onClick={copyToClipboard}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 rounded-md text-sm transition-colors"
                                title="Copy"
                            >
                                {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                            </button>
                            <button
                                onClick={handleExportMarkdown}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 rounded-md text-sm transition-colors"
                                title="Export Markdown"
                            >
                                <Download size={16} />
                                MD
                            </button>
                            <button
                                onClick={handleExportHtml}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 rounded-md text-sm transition-colors"
                                title="Export HTML"
                            >
                                <Download size={16} />
                                HTML
                            </button>
                        </>
                    )}
                    {isEditing && (
                        <>
                            <button
                                onClick={handleCancelEdit}
                                className="px-4 py-2 hover:bg-zinc-800 rounded-md text-sm transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                <Save size={16} />
                                {saving ? "Saving..." : "Save"}
                            </button>
                        </>
                    )}
                </div>
            </header>

            <main className="flex-1 p-8 overflow-auto">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4">
                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <p>Generating documentation with AI...</p>
                        <p className="text-xs">
                            Processing {recordingId ? currentRecording?.steps.length || 0 : steps.length} steps...
                        </p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <div className="bg-red-900/50 border border-red-800 rounded-lg p-6 max-w-md text-center">
                            <p className="text-red-400 font-medium mb-2">Error</p>
                            <p className="text-sm text-zinc-300">{error}</p>
                        </div>
                        <button
                            onClick={onBack}
                            className="text-sm text-zinc-400 hover:text-white transition-colors"
                        >
                            Go back and try again
                        </button>
                    </div>
                ) : isEditing ? (
                    <div className="max-w-4xl mx-auto">
                        <textarea
                            value={editedMarkdown}
                            onChange={(e) => setEditedMarkdown(e.target.value)}
                            className="w-full h-[calc(100vh-200px)] bg-zinc-900 p-6 rounded-lg border border-zinc-800 font-mono text-sm text-zinc-300 resize-none focus:outline-none focus:border-blue-500"
                            placeholder="Edit your documentation..."
                        />
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto bg-zinc-900 p-8 rounded-lg border border-zinc-800 shadow-lg">
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
                                {markdown}
                            </ReactMarkdown>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
