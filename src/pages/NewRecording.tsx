import { useEffect, useState } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRecorderStore, Step } from "../store/recorderStore";
import { useRecordingsStore, StepInput } from "../store/recordingsStore";
import { Play, Square, FileText, Wand2, Settings, X, Save, ArrowLeft, TrendingUp, List } from "lucide-react";
import RecorderOverlay from "../features/recorder/RecorderOverlay";

interface NewRecordingProps {
    onBack: () => void;
    onGenerate: () => void;
    onSettings: () => void;
    onSaved: (recordingId: string) => void;
}

export default function NewRecording({ onBack, onGenerate, onSettings, onSaved }: NewRecordingProps) {
    const { isRecording, setIsRecording, steps, addStep, removeStep, clearSteps } = useRecorderStore();
    const { createRecording, saveSteps } = useRecordingsStore();
    const [recordingName, setRecordingName] = useState("");
    const [showNameDialog, setShowNameDialog] = useState(false);
    const [saving, setSaving] = useState(false);

    const deleteStep = async (index: number) => {
        const step = steps[index];
        if (step.screenshot) {
            try {
                await invoke("delete_screenshot", { path: step.screenshot });
            } catch (error) {
                console.error("Failed to delete screenshot:", error);
            }
        }
        removeStep(index);
    };

    useEffect(() => {
        const unlisten = listen<Step>("new-step", (event) => {
            console.log("New step received:", event.payload);
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
        } catch (error) {
            console.error("Failed to stop recording:", error);
        }
    };

    const handleSave = () => {
        if (steps.length === 0) return;
        setShowNameDialog(true);
    };

    const saveRecording = async () => {
        if (!recordingName.trim()) return;

        setSaving(true);
        try {
            const recordingId = await createRecording(recordingName.trim());

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
            }));

            await saveSteps(recordingId, stepInputs);
            clearSteps();
            setShowNameDialog(false);
            setRecordingName("");
            onSaved(recordingId);
        } catch (error) {
            console.error("Failed to save recording:", error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex h-screen bg-zinc-950 text-white relative">
            <RecorderOverlay />

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
                        onClick={onBack}
                        className="w-full flex items-center gap-3 px-4 py-2 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors text-zinc-400"
                    >
                        <TrendingUp size={16} />
                        Dashboard
                    </button>
                    <button className="w-full flex items-center gap-3 px-4 py-2 bg-zinc-900 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors">
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
                <div className="flex justify-between items-center mb-8">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={onBack}
                            className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <h2 className="text-2xl font-bold">New Recording</h2>
                    </div>

                    <div className="flex items-center gap-4">
                        {!isRecording ? (
                            <button
                                onClick={startRecording}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md font-medium transition-colors"
                            >
                                <Play size={16} />
                                Start Recording
                            </button>
                        ) : (
                            <button
                                onClick={stopRecording}
                                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md font-medium transition-colors animate-pulse"
                            >
                                <Square size={16} />
                                Stop Recording
                            </button>
                        )}

                        {steps.length > 0 && !isRecording && (
                            <>
                                <button
                                    onClick={handleSave}
                                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-md font-medium transition-colors"
                                >
                                    <Save size={16} />
                                    Save
                                </button>
                                <button
                                    onClick={onGenerate}
                                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-md font-medium transition-colors"
                                >
                                    <Wand2 size={16} />
                                    Generate Docs
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Steps Preview */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {steps.map((step, index) => (
                        <div key={index} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden relative">
                            <button
                                onClick={() => deleteStep(index)}
                                className="absolute top-2 right-2 z-10 w-6 h-6 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-colors"
                                title="Delete step"
                            >
                                <X size={14} />
                            </button>
                            {step.type_ === "click" && step.screenshot ? (
                                <>
                                    <div className="aspect-video bg-zinc-950 relative">
                                        <img
                                            src={convertFileSrc(step.screenshot)}
                                            alt={`Step ${index + 1}`}
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute top-2 left-2 bg-black/50 px-2 py-1 rounded text-xs">
                                            {new Date(step.timestamp).toLocaleTimeString()}
                                        </div>
                                    </div>
                                    <div className="p-4">
                                        <h3 className="font-medium text-sm text-zinc-300">Step {index + 1} (Click)</h3>
                                        <p className="text-xs text-zinc-500 mt-1">
                                            Clicked at ({Math.round(step.x || 0)}, {Math.round(step.y || 0)})
                                        </p>
                                    </div>
                                </>
                            ) : (
                                <>
                                    {step.screenshot && (
                                        <div className="aspect-video bg-zinc-950 relative">
                                            <img
                                                src={convertFileSrc(step.screenshot)}
                                                alt={`Step ${index + 1}`}
                                                className="w-full h-full object-cover"
                                            />
                                            <div className="absolute top-2 left-2 bg-black/50 px-2 py-1 rounded text-xs">
                                                {new Date(step.timestamp).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    )}
                                    <div className="p-4">
                                        <h3 className="font-medium text-sm text-zinc-300 mb-2">Step {index + 1} (Type)</h3>
                                        <div className="bg-zinc-950 p-3 rounded border border-zinc-800 font-mono text-sm text-blue-400 break-words">
                                            "{step.text}"
                                        </div>
                                    </div>
                                </>
                            )}
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
