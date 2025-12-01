import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRecorderStore } from "../store/recorderStore";
import { useRecordingsStore } from "../store/recordingsStore";
import { useSettingsStore } from "../store/settingsStore";
import { generateDocumentation } from "../lib/aiService";
import { ArrowLeft, Save, Edit3, X } from "lucide-react";
import ExportDropdown from "../components/ExportDropdown";
import Tooltip from "../components/Tooltip";
import MarkdownViewer from "../components/MarkdownViewer";
import Spinner from "../components/Spinner";
import { mapStepsForAI } from "../lib/stepMapper";
import { TiptapEditor } from "../components/editor";

export default function Editor() {
    const navigate = useNavigate();
    const { id: recordingId } = useParams<{ id: string }>();
    const { steps } = useRecorderStore();
    const { getRecording, saveDocumentation, currentRecording } = useRecordingsStore();
    const { openaiApiKey, openaiBaseUrl, openaiModel } = useSettingsStore();
    const [markdown, setMarkdown] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedMarkdown, setEditedMarkdown] = useState("");

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/');
        }
    };

    useEffect(() => {
        const generate = async () => {
            try {
                setError(null);

                // If we have a recordingId, use steps from the database
                if (recordingId) {
                    const recording = await getRecording(recordingId);
                    if (recording) {
                        const dbSteps = mapStepsForAI(recording.steps);

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
        setError(null);
        try {
            setMarkdown(editedMarkdown);
            if (recordingId) {
                await saveDocumentation(recordingId, editedMarkdown);
            }
            setIsEditing(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save documentation");
        } finally {
            setSaving(false);
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedMarkdown("");
    };



    return (
        <div className="flex h-screen text-white">
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-4">
                        <Tooltip content="Go back">
                            <button
                                onClick={handleBack}
                                className="p-2 hover:bg-white/10 rounded-md transition-colors"
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
                                        className="p-2 bg-white/10 hover:bg-white/15 rounded-md transition-colors"
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
                                        className="p-2 hover:bg-white/10 rounded-md transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </Tooltip>
                                <Tooltip content="Save changes">
                                    <button
                                        onClick={handleSave}
                                        disabled={saving}
                                        className="p-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-md transition-colors disabled:opacity-50"
                                    >
                                        <Save size={18} />
                                    </button>
                                </Tooltip>
                            </>
                        )}
                    </div>
                </div>
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-white/50 gap-4">
                        <Spinner size="lg" />
                        <p>Generating documentation with AI...</p>
                        <p className="text-xs">
                            Processing {recordingId ? currentRecording?.steps.length || 0 : steps.length} steps...
                        </p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-6 max-w-md text-center">
                            <p className="text-red-400 font-medium mb-2">Error</p>
                            <p className="text-sm text-white/70">{error}</p>
                        </div>
                        <button
                            onClick={handleBack}
                            className="text-sm text-white/60 hover:text-white transition-colors"
                        >
                            Go back and try again
                        </button>
                    </div>
                ) : isEditing ? (
                    <div className="max-w-4xl mx-auto">
                        <TiptapEditor
                            content={editedMarkdown}
                            onChange={setEditedMarkdown}
                            showSourceToggle={true}
                            toolbarGroups={['history', 'format', 'list']}
                            minHeight="calc(100vh - 200px)"
                            placeholder="Edit your documentation..."
                        />
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto glass-surface-2 p-8 rounded-xl shadow-lg print-content">
                        <MarkdownViewer content={markdown} className="markdown-content scroll-optimized" />
                    </div>
                )}
            </main>
        </div>
    );
}
