import { useState, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useRecorderStore } from "../store/recorderStore";
import { useRecordingsStore } from "../store/recordingsStore";
import { useSettingsStore } from "../store/settingsStore";
import { generateDocumentation } from "../lib/aiService";
import { ArrowLeft, Save, Edit3, X } from "lucide-react";
import ExportDropdown from "../components/ExportDropdown";
import Tooltip from "../components/Tooltip";
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



    return (
        <div className="flex h-screen bg-zinc-950 text-white">
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-4">
                        <Tooltip content="Go back">
                            <button
                                onClick={onBack}
                                className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        </Tooltip>
                        <h2 className="text-2xl font-bold">
                            {isEditing ? "Edit Documentation" : "Generated Documentation"}
                        </h2>
                    </div>

                    <div className="flex items-center gap-2">
                        {!loading && !error && !isEditing && (
                            <>
                                <Tooltip content="Edit">
                                    <button
                                        onClick={handleEdit}
                                        className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
                                    >
                                        <Edit3 size={18} />
                                    </button>
                                </Tooltip>
                                <ExportDropdown
                                    markdown={markdown}
                                    fileName="documentation"
                                />
                            </>
                        )}
                        {isEditing && (
                            <>
                                <Tooltip content="Cancel">
                                    <button
                                        onClick={handleCancelEdit}
                                        className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </Tooltip>
                                <Tooltip content="Save changes">
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="p-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
                                    >
                                        <Save size={18} />
                                    </button>
                                </Tooltip>
                            </>
                        )}
                    </div>
                </div>
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
                    <div className="max-w-3xl mx-auto bg-zinc-900 p-8 rounded-lg border border-zinc-800 shadow-lg print-content">
                        <div className="markdown-content">
                            <ReactMarkdown
                                urlTransform={(url) => url}
                                components={{
                                    h1: ({ children }) => <h1 className="text-2xl font-bold mb-4 mt-6">{children}</h1>,
                                    h2: ({ children }) => <h2 className="text-xl font-semibold mb-3 mt-5">{children}</h2>,
                                    h3: ({ children }) => <h3 className="text-lg font-medium mb-2 mt-4">{children}</h3>,
                                    p: ({ children }) => <p className="mb-4 text-zinc-300">{children}</p>,
                                    ul: ({ children }) => <ul className="list-disc pl-6 mb-4">{children}</ul>,
                                    ol: ({ children }) => <ol className="list-decimal pl-6 mb-4">{children}</ol>,
                                    li: ({ children }) => <li className="mb-1">{children}</li>,
                                    code: ({ children }) => <code className="bg-zinc-800 px-1 py-0.5 rounded text-sm">{children}</code>,
                                    pre: ({ children }) => <pre className="bg-zinc-800 p-4 rounded mb-4 overflow-x-auto">{children}</pre>,
                                    img: ({ src, alt }) => <img src={src ? convertFileSrc(src) : ''} alt={alt} className="max-w-full rounded my-4" />,
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
