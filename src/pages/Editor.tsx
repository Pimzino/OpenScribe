import { useState, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useRecorderStore } from "../store/recorderStore";
import { useRecordingsStore } from "../store/recordingsStore";
import { useSettingsStore } from "../store/settingsStore";
import { useGenerationStore } from "../store/generationStore";
import { generateDocumentationStreaming, StreamingCallbacks } from "../lib/aiService";
import { ArrowLeft, Save, Edit3, X } from "lucide-react";
import ExportDropdown from "../components/ExportDropdown";
import Tooltip from "../components/Tooltip";
import MarkdownViewer from "../components/MarkdownViewer";
import { GenerationSplitView } from "../components/generation";
import { mapStepsForAI } from "../lib/stepMapper";
import { TiptapEditor } from "../components/editor";

export default function Editor() {
    const navigate = useNavigate();
    const { id: recordingId } = useParams<{ id: string }>();
    const { steps: recorderSteps } = useRecorderStore();
    const { getRecording, saveDocumentation } = useRecordingsStore();
    const { openaiApiKey, openaiBaseUrl, openaiModel } = useSettingsStore();
    const {
        stepProgress,
        startGeneration,
        updateStepStatus,
        appendStreamingText,
        completeStep,
        setStepError,
        updateDocument,
        finishGeneration,
        cancelGeneration,
        resetGeneration,
    } = useGenerationStore();

    const [markdown, setMarkdown] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editedMarkdown, setEditedMarkdown] = useState("");
    const [stepsForGeneration, setStepsForGeneration] = useState<ReturnType<typeof mapStepsForAI>>([]);
    const generationStarted = useRef(false);

    const handleBack = () => {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            navigate('/');
        }
    };

    useEffect(() => {
        // Prevent double generation in strict mode
        if (generationStarted.current) return;
        generationStarted.current = true;

        const generate = async () => {
            try {
                setError(null);

                // Get steps from the appropriate source
                let steps: ReturnType<typeof mapStepsForAI>;
                let workflowTitle: string | undefined;
                if (recordingId) {
                    const recording = await getRecording(recordingId);
                    if (!recording) {
                        setError("Recording not found");
                        setLoading(false);
                        return;
                    }
                    steps = mapStepsForAI(recording.steps);
                    workflowTitle = recording.recording.name;
                } else {
                    steps = recorderSteps.map(s => ({
                        type_: s.type_,
                        x: s.x,
                        y: s.y,
                        text: s.text,
                        timestamp: s.timestamp,
                        screenshot: s.screenshot,
                        element_name: s.element_name,
                        element_type: s.element_type,
                        element_value: s.element_value,
                        app_name: s.app_name,
                        description: s.description,
                        is_cropped: s.is_cropped,
                        ocr_text: s.ocr_text,
                        ocr_status: s.ocr_status,
                    }));
                }

                setStepsForGeneration(steps);

                // Start generation with streaming
                const abortController = startGeneration(steps.length);

                const callbacks: StreamingCallbacks = {
                    onStepStart: (index) => updateStepStatus(index, 'generating'),
                    onTextChunk: (index, text) => appendStreamingText(index, text),
                    onStepComplete: (index, text) => completeStep(index, text),
                    onDocumentUpdate: (md) => updateDocument(md),
                    onError: (index, err) => setStepError(index, err.message),
                    onComplete: async (finalMarkdown) => {
                        setMarkdown(finalMarkdown);
                        setLoading(false);
                        finishGeneration();
                        if (recordingId) {
                            await saveDocumentation(recordingId, finalMarkdown);
                        }
                    },
                };

                await generateDocumentationStreaming(
                    steps,
                    {
                        apiKey: openaiApiKey,
                        baseUrl: openaiBaseUrl,
                        model: openaiModel,
                        workflowTitle,
                    },
                    callbacks,
                    abortController.signal
                );
            } catch (err) {
                if (err instanceof DOMException && err.name === 'AbortError') {
                    // User cancelled - navigate back
                    resetGeneration();
                    navigate(-1);
                    return;
                }
                setError(err instanceof Error ? err.message : "Failed to generate documentation");
                resetGeneration();
                setLoading(false);
            }
        };
        generate();

        return () => {
            // Cleanup on unmount
            cancelGeneration();
        };
    }, []);

    const handleCancelGeneration = () => {
        cancelGeneration();
        navigate(-1);
    };

    const handleCloseGeneration = () => {
        resetGeneration();
        // Stay on the page to show the completed documentation
    };

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
                {stepProgress.length > 0 ? (
                    <div className="h-[calc(100vh-120px)]">
                        <GenerationSplitView
                            steps={stepsForGeneration}
                            onCancel={handleCancelGeneration}
                            onClose={handleCloseGeneration}
                        />
                    </div>
                ) : loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-white/50 gap-4">
                        <p>Preparing generation...</p>
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
