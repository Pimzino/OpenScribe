import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useRecorderStore, Step } from "../store/recorderStore";
import { useRecordingsStore, StepInput } from "../store/recordingsStore";
import { useSettingsStore } from "../store/settingsStore";
import { Play, Square, Wand2, Save, ArrowLeft, RotateCcw } from "lucide-react";
import RecorderOverlay from "../features/recorder/RecorderOverlay";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";
import ImageCropper from "../components/ImageCropper";
import DraggableStepCard from "../components/DraggableStepCard";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";

export default function NewRecording() {
    const navigate = useNavigate();
    const { isRecording, setIsRecording, steps, addStep, removeStep, clearSteps, updateStepDescription, updateStepScreenshot, reorderSteps } = useRecorderStore();
    const { createRecording, saveStepsWithPath } = useRecordingsStore();
    const { screenshotPath } = useSettingsStore();
    const [recordingName, setRecordingName] = useState("");
    const [showNameDialog, setShowNameDialog] = useState(false);
    const [saving, setSaving] = useState(false);
    const [generateAfterSave, setGenerateAfterSave] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [deletingIndex, setDeletingIndex] = useState<number | null>(null);
    const [croppingIndex, setCroppingIndex] = useState<number | null>(null);
    const [cropTimestamps, setCropTimestamps] = useState<Record<number, number>>({});

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const deleteStep = async (index: number) => {
        setDeletingIndex(index);
        const step = steps[index];
        if (step.screenshot) {
            try {
                await invoke("delete_screenshot", { path: step.screenshot });
            } catch (error) {
                console.error("Failed to delete screenshot:", error);
            }
        }
        removeStep(index);
        setDeletingIndex(null);
    };

    useEffect(() => {
        const unlisten = listen<Step>("new-step", (event) => {
            addStep(event.payload);
        });

        // Listen for manual captures from the monitor picker
        const unlistenManualCapture = listen<string>("manual-capture-complete", (event) => {
            const screenshotPath = event.payload;
            const captureStep: Step = {
                type_: "capture",
                timestamp: Date.now(),
                screenshot: screenshotPath,
            };
            addStep(captureStep);
        });

        return () => {
            unlisten.then((f) => f());
            unlistenManualCapture.then((f) => f());
        };
    }, [addStep]);

    const startRecording = async () => {
        try {
            await invoke("start_recording");
            setIsRecording(true);
            // Don't clear steps to allow resume functionality
            // Minimize window to keep it out of the way during recording
            await getCurrentWindow().minimize();
        } catch (error) {
            console.error("Failed to start recording:", error);
        }
    };

    const stopRecording = async () => {
        try {
            await invoke("stop_recording");
            setIsRecording(false);
            // Restore window when recording stops
            await getCurrentWindow().unminimize();
            await getCurrentWindow().setFocus();
        } catch (error) {
            console.error("Failed to stop recording:", error);
        }
    };

    const handleSave = () => {
        if (steps.length === 0) return;
        setGenerateAfterSave(false);
        setShowNameDialog(true);
    };

    const handleGenerateDocs = () => {
        if (steps.length === 0) return;
        setGenerateAfterSave(true);
        setShowNameDialog(true);
    };

    const handleCropSave = async (croppedImageBase64: string) => {
        if (croppingIndex === null) return;

        const step = steps[croppingIndex];
        if (!step.screenshot) return;

        try {
            // Save cropped image to the same path (overwrite)
            await invoke("save_cropped_image", {
                path: step.screenshot,
                base64Data: croppedImageBase64
            });

            // Update step to mark as cropped
            updateStepScreenshot(croppingIndex, step.screenshot, true);

            // Update timestamp to force image reload (cache busting)
            setCropTimestamps(prev => ({ ...prev, [croppingIndex]: Date.now() }));
        } catch (error) {
            console.error("Failed to save cropped image:", error);
        }

        setCroppingIndex(null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;

        if (over && active.id !== over.id) {
            const oldIndex = steps.findIndex((_, idx) => `step-${idx}` === active.id);
            const newIndex = steps.findIndex((_, idx) => `step-${idx}` === over.id);

            if (oldIndex !== -1 && newIndex !== -1) {
                reorderSteps(oldIndex, newIndex);
            }
        }
    };

    const saveRecording = async () => {
        if (!recordingName.trim()) return;

        setSaving(true);
        setSaveError(null);
        try {
            const name = recordingName.trim();
            const recordingId = await createRecording(name);

            const stepInputs: StepInput[] = steps.map(step => ({
                type_: step.type_,
                x: step.x,
                y: step.y,
                text: step.text,
                timestamp: step.timestamp,
                screenshot: step.screenshot,
                element_name: step.element_name,
                element_type: step.element_type,
                element_value: step.element_value,
                app_name: step.app_name,
                description: step.description,
                is_cropped: step.is_cropped,
            }));

            await saveStepsWithPath(recordingId, name, stepInputs, screenshotPath || undefined);
            clearSteps();
            setShowNameDialog(false);
            setRecordingName("");

            if (generateAfterSave) {
                navigate(`/editor/${recordingId}`);
            } else {
                navigate(`/recordings/${recordingId}`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Failed to save recording";
            setSaveError(errorMessage);
        } finally {
            setSaving(false);
            setGenerateAfterSave(false);
        }
    };

    return (
        <div className="flex h-screen text-white relative">
            <RecorderOverlay />

            {/* Image Cropper Modal */}
            {croppingIndex !== null && steps[croppingIndex]?.screenshot && (
                <ImageCropper
                    imageSrc={convertFileSrc(steps[croppingIndex].screenshot!)}
                    onSave={handleCropSave}
                    onCancel={() => setCroppingIndex(null)}
                />
            )}

            {/* Name Dialog */}
            {showNameDialog && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-surface-2 rounded-2xl p-6 w-96">
                        <h3 className="text-lg font-semibold mb-4">Save Recording</h3>
                        <input
                            type="text"
                            value={recordingName}
                            onChange={(e) => setRecordingName(e.target.value)}
                            placeholder="Enter recording name..."
                            className="w-full px-3 py-2 bg-[#161316] border border-white/10 rounded-md text-white placeholder-white/50 focus:outline-none focus:border-[#2721E8] mb-4"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && recordingName.trim()) {
                                    saveRecording();
                                }
                            }}
                        />
                        {saveError && (
                            <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-md text-sm text-red-400">
                                {saveError}
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowNameDialog(false)}
                                className="px-4 py-2 rounded-md hover:bg-white/10 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveRecording}
                                disabled={!recordingName.trim() || saving}
                                className="px-4 py-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {saving ? "Saving..." : "Save"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Sidebar
                activePage="new-recording"
                onNavigate={(page) => {
                    if (page === "dashboard" || page === "recordings") navigate('/');
                    else if (page === "settings") navigate('/settings');
                }}
            />

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-4">
                        <Tooltip content="Go back">
                            <button
                                onClick={() => navigate('/')}
                                className="p-2 hover:bg-white/10 rounded-md transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        </Tooltip>
                        <h2 className="text-2xl font-bold">New Recording</h2>
                    </div>

                    <div className="flex items-center gap-2">
                        {!isRecording ? (
                            steps.length === 0 ? (
                                <Tooltip content="Start recording">
                                    <button
                                        onClick={startRecording}
                                        className="p-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-md transition-colors"
                                    >
                                        <Play size={18} />
                                    </button>
                                </Tooltip>
                            ) : (
                                <Tooltip content="Resume recording">
                                    <button
                                        onClick={startRecording}
                                        className="p-2 bg-green-600 hover:bg-green-700 rounded-md transition-colors"
                                    >
                                        <RotateCcw size={18} />
                                    </button>
                                </Tooltip>
                            )
                        ) : (
                            <Tooltip content="Stop recording">
                                <button
                                    onClick={stopRecording}
                                    className="p-2 bg-red-600 hover:bg-red-700 rounded-md transition-colors animate-pulse"
                                >
                                    <Square size={18} />
                                </button>
                            </Tooltip>
                        )}

                        {steps.length > 0 && !isRecording && (
                            <>
                                <Tooltip content="Save recording">
                                    <button
                                        onClick={handleSave}
                                        className="p-2 bg-green-600 hover:bg-green-700 rounded-md transition-colors"
                                    >
                                        <Save size={18} />
                                    </button>
                                </Tooltip>
                                <Tooltip content="Generate documentation">
                                    <button
                                        onClick={handleGenerateDocs}
                                        className="p-2 bg-[#49B8D3] hover:bg-[#5fc5e0] rounded-md transition-colors"
                                    >
                                        <Wand2 size={18} />
                                    </button>
                                </Tooltip>
                            </>
                        )}
                    </div>
                </div>

                {/* Steps Preview */}
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                >
                    <SortableContext
                        items={steps.map((_, idx) => `step-${idx}`)}
                        strategy={rectSortingStrategy}
                    >
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 scroll-optimized">
                            {steps.map((step, index) => (
                                <DraggableStepCard
                                    key={`step-${index}`}
                                    id={`step-${index}`}
                                    step={step}
                                    index={index}
                                    onDelete={() => deleteStep(index)}
                                    onCrop={() => setCroppingIndex(index)}
                                    onUpdateDescription={(desc) => updateStepDescription(index, desc)}
                                    isDeleting={deletingIndex === index}
                                    cropTimestamp={cropTimestamps[index]}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </DndContext>

                {steps.length === 0 && !isRecording && (
                    <div className="col-span-full flex flex-col items-center justify-center h-64 border-2 border-dashed border-white/20 rounded-lg text-white/50">
                        <p>No steps recorded yet.</p>
                        <p className="text-sm">Click "Start Recording" to begin.</p>
                    </div>
                )}
            </main>
        </div>
    );
}
