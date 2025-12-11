import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useRecordingsStore, Step as DBStep } from "../store/recordingsStore";
import { useRecorderStore } from "../store/recorderStore";
import { generateDocumentationStreaming, StreamingCallbacks } from "../lib/aiService";
import { useSettingsStore } from "../store/settingsStore";
import { useGenerationStore } from "../store/generationStore";
import { ArrowLeft, Wand2, Check, Pencil, X, Save, XCircle, Play, Square, MapPin } from "lucide-react";
import ExportDropdown from "../components/ExportDropdown";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";
import MarkdownViewer from "../components/MarkdownViewer";
import Spinner from "../components/Spinner";
import { GenerationSplitView } from "../components/generation";
import { mapStepsForAI } from "../lib/stepMapper";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import DraggableStepCard from "../components/DraggableStepCard";
import { TiptapEditor } from '../components/editor';
import ImageCropper from "../components/ImageCropper";

export default function RecordingDetail() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { currentRecording, getRecording, saveDocumentation, loading } = useRecordingsStore();
    const { isRecording, setIsRecording } = useRecorderStore();
    const { openaiApiKey, openaiBaseUrl, openaiModel, screenshotPath } = useSettingsStore();
    const {
        isGenerating,
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

    const [activeTab, setActiveTab] = useState<"steps" | "docs">("docs");
    const [showRegenerationModal, setShowRegenerationModal] = useState(false);
    const [stepsForRegeneration, setStepsForRegeneration] = useState<ReturnType<typeof mapStepsForAI>>([]);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [croppingStepId, setCroppingStepId] = useState<string | null>(null);
    const [cropTimestamps, setCropTimestamps] = useState<Record<string, number>>({});

    // New state for delete & record more functionality
    const [localSteps, setLocalSteps] = useState<DBStep[]>([]);
    const [deletedStepIds, setDeletedStepIds] = useState<Set<string>>(new Set());
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [insertPosition, setInsertPosition] = useState<number | null>(null);
    // Use global isRecording state from recorderStore instead of local state
    // This prevents the global hotkey handler in App.tsx from navigating away
    const [isSelectingPosition, setIsSelectingPosition] = useState(false);
    const [saving, setSaving] = useState(false);
    const [deletingStepId, setDeletingStepId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    useEffect(() => {
        if (id) {
            getRecording(id);
        }
    }, [id, getRecording]);

    // Initialize local steps when recording loads
    useEffect(() => {
        if (currentRecording?.steps) {
            setLocalSteps(currentRecording.steps);
            setDeletedStepIds(new Set());
            setHasUnsavedChanges(false);
            setInsertPosition(null);
        }
    }, [currentRecording?.recording.id]);

    // Listen for new-step events when recording more steps
    useEffect(() => {
        if (!isRecording) return;

        const unlisten = listen<any>("new-step", (event) => {
            const newStep = event.payload;

            // Insert at selected position
            setLocalSteps(prev => {
                const newSteps = [...prev];
                const insertIdx = insertPosition !== null ? insertPosition : prev.length;
                newSteps.splice(insertIdx, 0, {
                    ...newStep,
                    id: `temp-${Date.now()}-${Math.random()}`, // Temporary ID
                    screenshot_path: newStep.screenshot // Map screenshot to screenshot_path
                });
                return newSteps;
            });

            // Increment insert position so next step goes after
            if (insertPosition !== null) {
                setInsertPosition(prev => prev! + 1);
            }

            setHasUnsavedChanges(true);
        });

        // Listen for manual captures from the monitor picker
        const unlistenManualCapture = listen<string>("manual-capture-complete", (event) => {
            const screenshotPath = event.payload;

            // Insert at selected position
            setLocalSteps(prev => {
                const newSteps = [...prev];
                const insertIdx = insertPosition !== null ? insertPosition : prev.length;
                newSteps.splice(insertIdx, 0, {
                    id: `temp-${Date.now()}-${Math.random()}`, // Temporary ID
                    type_: "capture",
                    timestamp: Date.now(),
                    screenshot_path: screenshotPath,
                });
                return newSteps;
            });

            // Increment insert position so next step goes after
            if (insertPosition !== null) {
                setInsertPosition(prev => prev! + 1);
            }

            setHasUnsavedChanges(true);
        });

        return () => {
            unlisten.then(f => f());
            unlistenManualCapture.then(f => f());
        };
    }, [isRecording, insertPosition]);

    // Listen for hotkey-stop event to stop recording from this page
    // This handles the case when user presses the stop hotkey while recording more steps
    useEffect(() => {
        const unlisten = listen("hotkey-stop", async () => {
            if (isRecording) {
                await stopRecordingMore();
            }
        });

        return () => { unlisten.then(f => f()); };
    }, [isRecording]);

    const handleRegenerate = async () => {
        if (!currentRecording || !id) return;

        setError(null);
        const steps = mapStepsForAI(currentRecording.steps);
        setStepsForRegeneration(steps);
        setShowRegenerationModal(true);

        const abortController = startGeneration(steps.length);

        const callbacks: StreamingCallbacks = {
            onStepStart: (index) => updateStepStatus(index, 'generating'),
            onTextChunk: (index, text) => appendStreamingText(index, text),
            onStepComplete: (index, text) => completeStep(index, text),
            onDocumentUpdate: (md) => updateDocument(md),
            onError: (index, err) => setStepError(index, err.message),
            onComplete: async (finalMarkdown) => {
                await saveDocumentation(id, finalMarkdown);
                await getRecording(id);
                finishGeneration();
            },
        };

        try {
            await generateDocumentationStreaming(
                steps,
                {
                    apiKey: openaiApiKey,
                    baseUrl: openaiBaseUrl,
                    model: openaiModel,
                },
                callbacks,
                abortController.signal
            );
        } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') {
                // User cancelled
                setShowRegenerationModal(false);
                resetGeneration();
                return;
            }
            const errorMessage = error instanceof Error ? error.message : "Failed to regenerate documentation";
            setError(errorMessage);
            setShowRegenerationModal(false);
            resetGeneration();
        }
    };

    const handleCancelRegeneration = () => {
        cancelGeneration();
        setShowRegenerationModal(false);
    };

    const handleCloseRegeneration = () => {
        resetGeneration();
        setShowRegenerationModal(false);
    };

    const handleStartEdit = () => {
        setEditedContent(currentRecording?.recording.documentation || "");
        setIsEditing(true);
    };

    const handleSaveEdit = async () => {
        if (!id) return;
        setError(null);
        try {
            await saveDocumentation(id, editedContent);
            await getRecording(id);
            setIsEditing(false);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Failed to save documentation";
            setError(errorMessage);
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setEditedContent("");
    };

    const handleNavigate = (page: "dashboard" | "recordings" | "settings") => {
        if (hasUnsavedChanges) {
            const confirmed = window.confirm("You have unsaved changes. Do you want to discard them?");
            if (!confirmed) return;
        }

        if (page === "dashboard") navigate('/');
        else if (page === "recordings") navigate('/recordings');
        else if (page === "settings") navigate('/settings');
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over || !id || active.id === over.id) return;

        const oldIndex = localSteps.findIndex(s => s.id === active.id);
        const newIndex = localSteps.findIndex(s => s.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            // Reorder in local state
            const reorderedSteps = [...localSteps];
            const [removed] = reorderedSteps.splice(oldIndex, 1);
            reorderedSteps.splice(newIndex, 0, removed);
            setLocalSteps(reorderedSteps);
            setHasUnsavedChanges(true);
        }
    };

    const handleDeleteStep = (stepId: string) => {
        setDeletingStepId(stepId);
        setLocalSteps(prev => prev.filter(s => s.id !== stepId));
        setDeletedStepIds(prev => new Set(prev).add(stepId));
        setHasUnsavedChanges(true);
        setTimeout(() => setDeletingStepId(null), 100);
    };

    const handleSelectInsertPosition = (index: number) => {
        setInsertPosition(index);
    };

    const togglePositionSelection = () => {
        setIsSelectingPosition(prev => !prev);
        if (isSelectingPosition) {
            setInsertPosition(null);
        }
    };

    const startRecordingMore = async () => {
        if (insertPosition === null) {
            setError("Please select where to insert new steps first");
            return;
        }

        try {
            await invoke("start_recording");
            setIsRecording(true);  // Use global state to prevent App.tsx hotkey handler from navigating
            setIsSelectingPosition(false);
            // Minimize window
            await getCurrentWindow().minimize();
        } catch (error) {
            console.error("Failed to start recording:", error);
            setError(error instanceof Error ? error.message : "Failed to start recording");
        }
    };

    const stopRecordingMore = async () => {
        try {
            await invoke("stop_recording");
            setIsRecording(false);  // Use global state
            // Restore window
            await getCurrentWindow().unminimize();
            await getCurrentWindow().setFocus();
        } catch (error) {
            console.error("Failed to stop recording:", error);
            setError(error instanceof Error ? error.message : "Failed to stop recording");
        }
    };

    const handleSaveChanges = async () => {
        if (!id || !hasUnsavedChanges) return;

        setSaving(true);
        setError(null);

        try {
            // 1. Delete removed steps
            for (const stepId of deletedStepIds) {
                await invoke("delete_step", { stepId });
            }

            // 2. Get recording name for screenshot path
            const recording = currentRecording?.recording;
            if (!recording) throw new Error("Recording not found");

            // 3. Prepare new steps for saving
            const stepsToSave = localSteps
                .filter(step => step.id.startsWith('temp-'))
                .map(step => ({
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
                    description: step.description,
                    is_cropped: step.is_cropped,
                }));

            // 4. Save new steps
            if (stepsToSave.length > 0) {
                await invoke("save_steps_with_path", {
                    recordingId: id,
                    recordingName: recording.name,
                    steps: stepsToSave,
                    screenshotPath: screenshotPath || null
                });
            }

            // 5. Reorder all steps based on localSteps order (only existing steps)
            const existingStepIds = localSteps
                .filter(s => !s.id.startsWith('temp-'))
                .map(s => s.id);

            if (existingStepIds.length > 0) {
                await invoke("reorder_steps", {
                    recordingId: id,
                    stepIds: existingStepIds
                });
            }

            // 6. Refresh recording
            await getRecording(id);

            // 7. Reset state
            setDeletedStepIds(new Set());
            setHasUnsavedChanges(false);
            setInsertPosition(null);
            setIsSelectingPosition(false);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Failed to save changes";
            setError(errorMessage);
        } finally {
            setSaving(false);
        }
    };

    const handleDiscardChanges = () => {
        if (currentRecording?.steps) {
            setLocalSteps(currentRecording.steps);
            setDeletedStepIds(new Set());
            setHasUnsavedChanges(false);
            setInsertPosition(null);
            setIsSelectingPosition(false);
        }
    };

    const handleUpdateDescription = async (stepId: string, description: string) => {
        if (!id) return;
        try {
            await invoke("update_step_description", { stepId, description });
            // Optionally refresh to ensure consistency
            await getRecording(id);
        } catch (error) {
            console.error("Failed to update step description:", error);
            setError(error instanceof Error ? error.message : "Failed to update step description");
        }
    };

    const handleCropSave = async (croppedImageBase64: string) => {
        if (!croppingStepId || !currentRecording) return;

        const step = currentRecording.steps.find(s => s.id === croppingStepId);
        if (!step?.screenshot_path) return;

        try {
            // Save cropped image to the same path (overwrite)
            await invoke("save_cropped_image", {
                path: step.screenshot_path,
                base64Data: croppedImageBase64
            });

            // Update step in database to mark as cropped
            await invoke("update_step_screenshot", {
                stepId: croppingStepId,
                screenshotPath: step.screenshot_path,
                isCropped: true
            });

            // Update timestamp to force image reload (cache busting)
            setCropTimestamps(prev => ({ ...prev, [croppingStepId]: Date.now() }));

            // Refresh recording data
            if (id) {
                await getRecording(id);
            }
        } catch (error) {
            console.error("Failed to save cropped image:", error);
            setError(error instanceof Error ? error.message : "Failed to save cropped image");
        }

        setCroppingStepId(null);
    };

    const croppingStep = croppingStepId ? currentRecording?.steps.find(s => s.id === croppingStepId) : null;

    if (!id) {
        return (
            <div className="flex h-screen text-white items-center justify-center">
                <div className="text-white/50">Invalid recording ID</div>
            </div>
        );
    }

    if (loading && !currentRecording) {
        return (
            <div className="flex h-screen text-white items-center justify-center">
                <div className="text-white/50">Loading recording...</div>
            </div>
        );
    }

    if (!currentRecording) {
        return (
            <div className="flex h-screen text-white items-center justify-center">
                <div className="text-white/50">Recording not found</div>
            </div>
        );
    }

    return (
        <div className="flex h-screen text-white">
            <Sidebar activePage="recording-detail" onNavigate={handleNavigate} />

            {/* Image Cropper Modal */}
            {croppingStep?.screenshot_path && (
                <ImageCropper
                    imageSrc={convertFileSrc(croppingStep.screenshot_path)}
                    onSave={handleCropSave}
                    onCancel={() => setCroppingStepId(null)}
                />
            )}

            {/* Regeneration Modal with Split View */}
            {showRegenerationModal && (
                <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-8">
                    <div className="w-full max-w-6xl h-[80vh] glass-surface-1 rounded-xl p-6">
                        <GenerationSplitView
                            steps={stepsForRegeneration}
                            onCancel={handleCancelRegeneration}
                            onClose={handleCloseRegeneration}
                        />
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-4">
                        <Tooltip content="Go back">
                            <button
                                onClick={() => {
                                    if (hasUnsavedChanges) {
                                        const confirmed = window.confirm("You have unsaved changes. Do you want to discard them?");
                                        if (!confirmed) return;
                                    }
                                    navigate('/recordings');
                                }}
                                className="p-2 hover:bg-white/10 rounded-md transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        </Tooltip>
                        <div>
                            <h2 className="text-2xl font-bold">{currentRecording.recording.name}</h2>
                            <p className="text-sm text-white/50">
                                {currentRecording.steps.length} steps • Created {new Date(currentRecording.recording.created_at).toLocaleDateString()}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {activeTab === "steps" && (
                            <>
                                {hasUnsavedChanges && (
                                    <>
                                        <Tooltip content="Discard changes">
                                            <button
                                                onClick={handleDiscardChanges}
                                                className="p-2 bg-white/10 hover:bg-white/15 rounded-md transition-colors"
                                            >
                                                <XCircle size={18} />
                                            </button>
                                        </Tooltip>
                                        <Tooltip content="Save changes">
                                            <button
                                                onClick={handleSaveChanges}
                                                disabled={saving}
                                                className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded-md transition-colors flex items-center gap-2 disabled:opacity-50"
                                            >
                                                {saving ? <Spinner size="sm" /> : <Save size={18} />}
                                                <span className="text-sm font-medium">Save Changes</span>
                                            </button>
                                        </Tooltip>
                                    </>
                                )}
                                {!isRecording && !hasUnsavedChanges && (
                                    <Tooltip content={isSelectingPosition ? "Cancel position selection" : "Select where to insert new steps"}>
                                        <button
                                            onClick={togglePositionSelection}
                                            className={`px-3 py-2 rounded-md transition-colors flex items-center gap-2 ${
                                                isSelectingPosition
                                                    ? 'bg-white/10 hover:bg-white/15'
                                                    : 'bg-[#2721E8] hover:bg-[#4a45f5]'
                                            }`}
                                        >
                                            <MapPin size={18} />
                                            <span className="text-sm font-medium">
                                                {isSelectingPosition ? 'Cancel' : 'Select Position'}
                                            </span>
                                        </button>
                                    </Tooltip>
                                )}
                                {insertPosition !== null && !isRecording && (
                                    <Tooltip content="Start recording more steps">
                                        <button
                                            onClick={startRecordingMore}
                                            className="px-3 py-2 bg-green-600 hover:bg-green-700 rounded-md transition-colors flex items-center gap-2"
                                        >
                                            <Play size={18} />
                                            <span className="text-sm font-medium">Record More</span>
                                        </button>
                                    </Tooltip>
                                )}
                                {isRecording && (
                                    <Tooltip content="Stop recording">
                                        <button
                                            onClick={stopRecordingMore}
                                            className="px-3 py-2 bg-red-600 hover:bg-red-700 rounded-md transition-colors flex items-center gap-2 animate-pulse"
                                        >
                                            <Square size={18} />
                                            <span className="text-sm font-medium">Stop Recording</span>
                                        </button>
                                    </Tooltip>
                                )}
                            </>
                        )}
                        {activeTab === "docs" && currentRecording.recording.documentation && (
                            <>
                                {isEditing ? (
                                    <>
                                        <Tooltip content="Cancel">
                                            <button
                                                onClick={handleCancelEdit}
                                                className="p-2 hover:bg-white/10 rounded-md transition-colors"
                                            >
                                                <X size={18} />
                                            </button>
                                        </Tooltip>
                                        <Tooltip content="Save">
                                            <button
                                                onClick={handleSaveEdit}
                                                className="p-2 bg-green-600 hover:bg-green-700 rounded-md transition-colors"
                                            >
                                                <Check size={18} />
                                            </button>
                                        </Tooltip>
                                    </>
                                ) : (
                                    <>
                                        <Tooltip content="Edit documentation">
                                            <button
                                                onClick={handleStartEdit}
                                                className="p-2 bg-white/10 hover:bg-white/15 rounded-md transition-colors"
                                            >
                                                <Pencil size={18} />
                                            </button>
                                        </Tooltip>
                                        <ExportDropdown
                                            markdown={currentRecording.recording.documentation}
                                            fileName={currentRecording.recording.name}
                                        />
                                    </>
                                )}
                            </>
                        )}
                        {!isEditing && (
                            <Tooltip content="Regenerate documentation">
                                <button
                                    onClick={handleRegenerate}
                                    disabled={isGenerating}
                                    className="p-2 bg-purple-600 hover:bg-purple-700 rounded-md transition-colors disabled:opacity-50"
                                >
                                    <Wand2 size={18} />
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-6 glass-surface-1 p-1 rounded-xl w-fit">
                    <button
                        onClick={() => setActiveTab("docs")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "docs" ? "bg-[#2721E8]/30 text-white" : "text-white/60 hover:text-white"
                            }`}
                    >
                        Documentation
                    </button>
                    <button
                        onClick={() => setActiveTab("steps")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "steps" ? "bg-[#2721E8]/30 text-white" : "text-white/60 hover:text-white"
                            }`}
                    >
                        Steps
                    </button>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg">
                        <p className="text-sm text-red-400">{error}</p>
                        <button
                            onClick={() => setError(null)}
                            className="mt-2 text-xs text-red-300 hover:text-red-200"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {activeTab === "docs" ? (
                    <div className={`glass-surface-2 rounded-xl print-content ${isEditing ? '' : 'p-6'}`}>
                        {currentRecording.recording.documentation ? (
                            isEditing ? (
                                <TiptapEditor
                                    content={editedContent}
                                    onChange={(value) => setEditedContent(value)}
                                    showSourceToggle={true}
                                    toolbarGroups={['history', 'heading', 'format', 'list', 'insert', 'code']}
                                    minHeight="500px"
                                    placeholder="Edit your documentation..."
                                />
                            ) : (
                                <MarkdownViewer content={currentRecording.recording.documentation} className="markdown-content scroll-optimized" />
                            )
                        ) : (
                            <div className="text-center py-12 text-white/50">
                                <p>No documentation generated yet</p>
                                <button
                                    onClick={handleRegenerate}
                                    disabled={isGenerating}
                                    className="mt-4 text-purple-500 hover:text-purple-400 disabled:opacity-50 flex items-center gap-2 mx-auto"
                                >
                                    Generate documentation
                                </button>
                            </div>
                        )}
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext
                            items={localSteps.map(s => s.id)}
                            strategy={rectSortingStrategy}
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 scroll-optimized">
                                {localSteps.map((step, index) => (
                                    <div key={step.id} className="relative">
                                        {isSelectingPosition && (
                                            <button
                                                onClick={() => handleSelectInsertPosition(index)}
                                                className={`absolute -top-3 left-0 right-0 h-6 flex items-center justify-center z-20 transition-all ${
                                                    insertPosition === index
                                                        ? 'bg-green-500/20 border-2 border-green-500'
                                                        : 'bg-white/10 border border-white/10 hover:bg-white/15'
                                                }`}
                                            >
                                                <MapPin size={14} className={insertPosition === index ? 'text-green-500' : 'text-white/60'} />
                                                {insertPosition === index && (
                                                    <span className="ml-1 text-xs text-green-500 font-medium">Insert Here</span>
                                                )}
                                            </button>
                                        )}
                                        <DraggableStepCard
                                            id={step.id}
                                            step={step}
                                            index={index}
                                            onDelete={() => handleDeleteStep(step.id)}
                                            onCrop={() => setCroppingStepId(step.id)}
                                            onUpdateDescription={(desc) => handleUpdateDescription(step.id, desc)}
                                            isDeleting={deletingStepId === step.id}
                                            cropTimestamp={cropTimestamps[step.id]}
                                        />
                                    </div>
                                ))}
                                {isSelectingPosition && (
                                    <button
                                        onClick={() => handleSelectInsertPosition(localSteps.length)}
                                        className={`h-32 flex items-center justify-center rounded-lg transition-all ${
                                            insertPosition === localSteps.length
                                                ? 'bg-green-500/20 border-2 border-green-500'
                                                : 'bg-white/10 border-2 border-dashed border-white/20 hover:bg-white/15'
                                        }`}
                                    >
                                        <div className="text-center">
                                            <MapPin size={24} className={insertPosition === localSteps.length ? 'text-green-500 mx-auto' : 'text-white/60 mx-auto'} />
                                            <span className={`text-sm ${insertPosition === localSteps.length ? 'text-green-500 font-medium' : 'text-white/60'}`}>
                                                {insertPosition === localSteps.length ? 'Insert Here' : 'Insert at End'}
                                            </span>
                                        </div>
                                    </button>
                                )}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </main>
        </div>
    );
}
