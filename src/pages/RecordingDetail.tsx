import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useRecordingsStore, Step as DBStep } from "../store/recordingsStore";
import { useRecorderStore } from "../store/recorderStore";
import { generateDocumentationStreaming, StreamingCallbacks } from "../lib/aiService";
import { useSettingsStore } from "../store/settingsStore";
import { useGenerationStore } from "../store/generationStore";
import { ArrowLeft, Wand2, Check, Pencil, X, Save, XCircle, Play, Square, MapPin, AlertTriangle } from "lucide-react";
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
import ImageEditor from "../components/ImageEditor";

export default function RecordingDetail() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const location = useLocation();
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
    const hasTriggeredGeneration = useRef(false);

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

    // Auto-trigger generation if navigated with triggerGeneration flag
    useEffect(() => {
        // Only trigger once per navigation with the flag
        if (location.state?.triggerGeneration && currentRecording && !isGenerating && !hasTriggeredGeneration.current) {
            hasTriggeredGeneration.current = true;
            // Clear the navigation state to prevent re-triggering
            navigate(location.pathname, { replace: true, state: {} });
            // Trigger generation
            handleRegenerate();
        }
    }, [location.state?.triggerGeneration, currentRecording, isGenerating]);

    // Reset the generation trigger flag when navigating to a different recording
    useEffect(() => {
        hasTriggeredGeneration.current = false;
    }, [id]);

    // Helper to copy screenshot to permanent location and register asset scope
    const copyScreenshotToPermanent = async (tempPath: string): Promise<string> => {
        if (!id || !currentRecording) return tempPath;

        try {
            // Copy to permanent location
            const permanentPath = await invoke<string>("copy_screenshot_to_permanent", {
                tempPath,
                recordingId: id,
                recordingName: currentRecording.recording.name,
                customScreenshotPath: screenshotPath || null
            });

            // Register asset scope so the image can be displayed
            // Handle both forward and backward slashes (Windows paths)
            const lastBackslash = permanentPath.lastIndexOf('\\');
            const lastForwardSlash = permanentPath.lastIndexOf('/');
            const lastSlash = Math.max(lastBackslash, lastForwardSlash);
            const screenshotDir = lastSlash > 0 ? permanentPath.substring(0, lastSlash) : permanentPath;
            await invoke("register_asset_scope", { path: screenshotDir });

            return permanentPath;
        } catch (error) {
            console.error("Failed to copy screenshot to permanent location:", error);
            // Return original path as fallback
            return tempPath;
        }
    };

    // Listen for new-step events when recording more steps
    useEffect(() => {
        if (!isRecording) return;

        const unlisten = listen<any>("new-step", async (event) => {
            const newStep = event.payload;
            const tempId = `temp-${Date.now()}-${Math.random()}`;

            // Copy screenshot to permanent location immediately so it displays
            let finalScreenshotPath = newStep.screenshot;
            if (newStep.screenshot) {
                finalScreenshotPath = await copyScreenshotToPermanent(newStep.screenshot);
            }

            // Insert at selected position
            setLocalSteps(prev => {
                const newSteps = [...prev];
                const insertIdx = insertPosition !== null ? insertPosition : prev.length;
                newSteps.splice(insertIdx, 0, {
                    ...newStep,
                    id: tempId,
                    recording_id: id!, // Will be associated on save
                    screenshot_path: finalScreenshotPath,
                    order_index: insertIdx, // Temporary, will be set correctly on save
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
        const unlistenManualCapture = listen<string>("manual-capture-complete", async (event) => {
            const tempScreenshotPath = event.payload;
            const tempId = `temp-${Date.now()}-${Math.random()}`;

            // Copy screenshot to permanent location immediately so it displays
            const finalScreenshotPath = await copyScreenshotToPermanent(tempScreenshotPath);

            // Insert at selected position
            setLocalSteps(prev => {
                const newSteps = [...prev];
                const insertIdx = insertPosition !== null ? insertPosition : prev.length;
                newSteps.splice(insertIdx, 0, {
                    id: tempId,
                    recording_id: id!, // Will be associated on save
                    type_: "capture",
                    timestamp: Date.now(),
                    screenshot_path: finalScreenshotPath,
                    order_index: insertIdx, // Temporary, will be set correctly on save
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
    }, [isRecording, insertPosition, id, currentRecording, screenshotPath]);

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
                    workflowTitle: currentRecording.recording.name,
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

    const handleNavigate = async (page: "dashboard" | "recordings" | "settings") => {
        if (hasUnsavedChanges) {
            const confirmed = window.confirm("You have unsaved changes. Do you want to discard them?");
            if (!confirmed) return;

            // Clean up temp step screenshots before navigating
            await cleanupTempScreenshots();
        }

        if (page === "dashboard") navigate('/');
        else if (page === "recordings") navigate('/recordings');
        else if (page === "settings") navigate('/settings');
    };

    // Helper to clean up screenshot files for unsaved temp steps
    const cleanupTempScreenshots = async () => {
        const tempStepsWithScreenshots = localSteps.filter(
            s => s.id.startsWith('temp-') && s.screenshot_path
        );

        for (const step of tempStepsWithScreenshots) {
            try {
                await invoke("delete_screenshot", { path: step.screenshot_path });
            } catch (error) {
                console.error("Failed to delete temp screenshot:", error);
            }
        }
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

    const handleDeleteStep = async (stepId: string) => {
        setDeletingStepId(stepId);

        // Find the step to check if it's a temp step with a screenshot
        const stepToDelete = localSteps.find(s => s.id === stepId);

        // If it's a temp step (not yet saved to DB), delete the screenshot file immediately
        // since it won't be cleaned up by delete_step (which looks up path from DB)
        if (stepToDelete?.id.startsWith('temp-') && stepToDelete.screenshot_path) {
            try {
                await invoke("delete_screenshot", { path: stepToDelete.screenshot_path });
            } catch (error) {
                console.error("Failed to delete temp screenshot:", error);
            }
        }

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

            // 3. Prepare new steps for saving with their correct order_index
            // Find the position of each new step in the localSteps array
            const stepsToSave = localSteps
                .map((step, index) => ({ step, index }))
                .filter(({ step }) => step.id.startsWith('temp-'))
                .map(({ step, index }) => ({
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
                    order_index: index, // Use position in localSteps as the order_index
                    screenshot_is_permanent: true, // Screenshots were already copied to permanent location
                }));

            // 4. Save new steps with their correct order indices
            if (stepsToSave.length > 0) {
                await invoke("save_steps_with_path", {
                    recordingId: id,
                    recordingName: recording.name,
                    steps: stepsToSave,
                    screenshotPath: screenshotPath || null
                });
            }

            // 5. Reorder existing steps based on their position in localSteps
            // Build the reorder list with position-based indices
            const existingStepsWithIndex = localSteps
                .map((step, index) => ({ step, index }))
                .filter(({ step }) => !step.id.startsWith('temp-'));

            if (existingStepsWithIndex.length > 0) {
                // Reorder existing steps to their new positions
                const stepIds = existingStepsWithIndex.map(({ step }) => step.id);
                await invoke("reorder_steps", {
                    recordingId: id,
                    stepIds: stepIds
                });

                // Now we need to update their order_index to match their position in localSteps
                // The reorder_steps function assigns indices 0, 1, 2... based on array order
                // But we need indices that account for new steps interspersed
                // So we need to call reorder with the full list after new steps are saved
            }

            // 6. Refresh recording to get the newly saved step IDs
            await getRecording(id);

            // 7. Final reorder: now that new steps have real IDs, reorder ALL steps
            // Get the fresh recording data
            const refreshedRecording = useRecordingsStore.getState().currentRecording;
            if (refreshedRecording) {
                // Map temp IDs to the order they should be in
                // Build the complete ordered list of step IDs
                const allStepIds = refreshedRecording.steps
                    .sort((a, b) => a.order_index - b.order_index)
                    .map(s => s.id);

                // Reorder all steps to ensure consistent ordering
                await invoke("reorder_steps", {
                    recordingId: id,
                    stepIds: allStepIds
                });

                // Refresh one more time to get final state
                await getRecording(id);
            }

            // 8. Reset state
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

    const handleDiscardChanges = async () => {
        if (currentRecording?.steps) {
            // Delete screenshot files for any temp steps that won't be saved
            await cleanupTempScreenshots();

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

    // Check if documentation is stale (steps modified after documentation was generated)
    const isDocumentationStale = currentRecording?.recording.documentation &&
        currentRecording.recording.documentation_generated_at &&
        currentRecording.recording.updated_at > currentRecording.recording.documentation_generated_at;

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

            {/* Image Editor Modal */}
            {croppingStep?.screenshot_path && (
                <ImageEditor
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
            <main className="flex-1 p-8 overflow-y-auto overflow-x-hidden scroll-container">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-4">
                        <Tooltip content="Go back">
                            <button
                                onClick={async () => {
                                    if (hasUnsavedChanges) {
                                        const confirmed = window.confirm("You have unsaved changes. Do you want to discard them?");
                                        if (!confirmed) return;
                                        // Clean up temp step screenshots before navigating
                                        await cleanupTempScreenshots();
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
                    <div className={`glass-surface-scroll rounded-xl print-content ${isEditing ? '' : 'p-6'}`}>
                        {/* Stale documentation warning */}
                        {isDocumentationStale && !isEditing && (
                            <div className="mb-4 p-3 bg-amber-500/20 border border-amber-500/50 rounded-lg flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle size={18} className="text-amber-400" />
                                    <span className="text-sm text-amber-200">
                                        Steps have been modified since documentation was generated.
                                    </span>
                                </div>
                                <button
                                    onClick={handleRegenerate}
                                    disabled={isGenerating}
                                    className="px-3 py-1 text-sm bg-amber-500/30 hover:bg-amber-500/40 text-amber-200 rounded-md transition-colors disabled:opacity-50 flex items-center gap-1"
                                >
                                    <Wand2 size={14} />
                                    Regenerate
                                </button>
                            </div>
                        )}
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
