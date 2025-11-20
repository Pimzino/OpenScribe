import { useEffect } from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRecorderStore, Step } from "../store/recorderStore";
import { Play, Square, FileText, Wand2 } from "lucide-react";
import RecorderOverlay from "../features/recorder/RecorderOverlay";

interface DashboardProps {
    onGenerate: () => void;
}

export default function Dashboard({ onGenerate }: DashboardProps) {
    const { isRecording, setIsRecording, steps, addStep, clearSteps } = useRecorderStore();

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

    return (
        <div className="flex h-screen bg-zinc-950 text-white relative">
            <RecorderOverlay />

            {/* Sidebar */}
            <aside className="w-64 border-r border-zinc-800 p-4">
                <h1 className="text-xl font-bold mb-8 flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <FileText size={18} />
                    </div>
                    OpenScribe
                </h1>

                <nav className="space-y-2">
                    <button className="w-full flex items-center gap-3 px-4 py-2 bg-zinc-900 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors">
                        <FileText size={16} />
                        My Recordings
                    </button>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-bold">Dashboard</h2>

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
                            <button
                                onClick={onGenerate}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-md font-medium transition-colors"
                            >
                                <Wand2 size={16} />
                                Generate Docs
                            </button>
                        )}
                    </div>
                </div>

                {/* Steps Preview */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {steps.map((step, index) => (
                        <div key={index} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                            {step.type_ === "click" && step.screenshot ? (
                                <>
                                    <div className="aspect-video bg-zinc-950 relative">
                                        <img
                                            src={convertFileSrc(step.screenshot)}
                                            alt={`Step ${index + 1}`}
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute top-2 right-2 bg-black/50 px-2 py-1 rounded text-xs">
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
                                <div className="p-4 flex flex-col h-full justify-center">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="font-medium text-sm text-zinc-300">Step {index + 1} (Type)</h3>
                                        <span className="text-xs text-zinc-500">{new Date(step.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                    <div className="bg-zinc-950 p-3 rounded border border-zinc-800 font-mono text-sm text-blue-400 break-words">
                                        "{step.text}"
                                    </div>
                                </div>
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
