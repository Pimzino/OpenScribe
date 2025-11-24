import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useRecorderStore, Step } from "../store/recorderStore";
import { useRecordingsStore, StepInput } from "../store/recordingsStore";
import { useSettingsStore } from "../store/settingsStore";
import { Play, Square, Wand2, X, Save, ArrowLeft, Crop } from "lucide-react";
import RecorderOverlay from "../features/recorder/RecorderOverlay";
import Spinner from "../components/Spinner";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";
import ImageCropper from "../components/ImageCropper";

export default function NewRecording() {
    const navigate = useNavigate();
    const { isRecording, setIsRecording, steps, addStep, removeStep, clearSteps, updateStepDescription, updateStepScreenshot } = useRecorderStore();
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

        return () => {
            unlisten.then((f) => f());
        };
    }, [addStep]);

    const startRecording = async () => {
        try {
            await invoke("start_recording");
            setIsRecording(true);
            clearSteps();
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
        <div className="flex h-screen bg-zinc-950 text-white relative">
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
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-96">
                        <h3 className="text-lg font-semibold mb-4">Save Recording</h3>
                        <input
                            type="text"
                            value={recordingName}
                            onChange={(e) => setRecordingName(e.target.value)}
                            placeholder="Enter recording name..."
                            className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500 mb-4"
                            autoFocus
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && recordingName.trim()) {
                                    saveRecording();
                                }
                            }}
                        />
                        {saveError && (
                            <div className="mb-4 p-3 bg-red-900/50 border border-red-800 rounded-md text-sm text-red-400">
                                {saveError}
                            </div>
                        )}
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowNameDialog(false)}
                                className="px-4 py-2 rounded-md hover:bg-zinc-800 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveRecording}
                                disabled={!recordingName.trim() || saving}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                                className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        </Tooltip>
                        <h2 className="text-2xl font-bold">New Recording</h2>
                    </div>

                    <div className="flex items-center gap-2">
                        {!isRecording ? (
                            <Tooltip content="Start recording">
                                <button
                                    onClick={startRecording}
                                    className="p-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                                >
                                    <Play size={18} />
                                </button>
                            </Tooltip>
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
                                        className="p-2 bg-purple-600 hover:bg-purple-700 rounded-md transition-colors"
                                    >
                                        <Wand2 size={18} />
                                    </button>
                                </Tooltip>
                            </>
                        )}
                    </div>
                </div>

                {/* Steps Preview */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {steps.map((step, index) => (
                        <div key={index} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden relative">
                            <div className="absolute top-2 right-2 z-10 flex gap-1">
                                {step.screenshot && (
                                    <Tooltip content="Crop screenshot">
                                        <button
                                            onClick={() => setCroppingIndex(index)}
                                            className="p-1 bg-blue-600 hover:bg-blue-700 rounded-full flex items-center justify-center transition-colors"
                                        >
                                            <Crop size={14} />
                                        </button>
                                    </Tooltip>
                                )}
                                <Tooltip content="Delete step">
                                    <button
                                        onClick={() => deleteStep(index)}
                                        disabled={deletingIndex === index}
                                        className="p-1 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {deletingIndex === index ? <Spinner size="sm" /> : <X size={14} />}
                                    </button>
                                </Tooltip>
                            </div>
                            {step.screenshot && (
                                <div className="aspect-video bg-zinc-950 relative">
                                    <img
                                        src={convertFileSrc(step.screenshot) + (cropTimestamps[index] ? `?t=${cropTimestamps[index]}` : '')}
                                        alt={`Step ${index + 1}`}
                                        className="w-full h-full object-cover"
                                    />
                                    <div className="absolute top-2 left-2 bg-black/50 px-2 py-1 rounded text-xs">
                                        {new Date(step.timestamp).toLocaleTimeString()}
                                    </div>
                                    {step.is_cropped && (
                                        <div className="absolute bottom-2 left-2 bg-blue-600/80 px-2 py-1 rounded text-xs">
                                            Cropped
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="p-4">
                                <h3 className="font-medium text-sm text-zinc-300 mb-2">
                                    Step {index + 1} ({step.type_ === "click" ? "Click" : step.type_ === "type" ? "Type" : "Capture"})
                                </h3>
                                {step.type_ === "click" && (
                                    <p className="text-xs text-zinc-500 mb-2">
                                        Clicked at ({Math.round(step.x || 0)}, {Math.round(step.y || 0)})
                                    </p>
                                )}
                                {step.type_ === "type" && step.text && (
                                    <div className="bg-zinc-950 p-3 rounded border border-zinc-800 font-mono text-sm text-blue-400 break-words mb-2">
                                        "{step.text}"
                                    </div>
                                )}
                                {step.type_ === "capture" && (
                                    <p className="text-xs text-zinc-500 mb-2">
                                        Manual screenshot capture
                                    </p>
                                )}
                                <textarea
                                    value={step.description || ""}
                                    onChange={(e) => updateStepDescription(index, e.target.value)}
                                    placeholder="Add description for AI (optional)..."
                                    className="w-full px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-blue-500 resize-none"
                                    rows={2}
                                />
                            </div>
                        </div>
                    ))}

                    {steps.length === 0 && !isRecording && (
                        <div className="col-span-full flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-800 rounded-lg text-zinc-500">
                            <p>No steps recorded yet.</p>
                            <p className="text-sm">Click "Start Recording" to begin.</p>
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
