import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { useRecordingsStore } from "../store/recordingsStore";
import { generateDocumentation } from "../lib/aiService";
import { useSettingsStore } from "../store/settingsStore";
import { ArrowLeft, Wand2, Check, Pencil, X } from "lucide-react";
import ExportDropdown from "../components/ExportDropdown";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";
import MarkdownViewer from "../components/MarkdownViewer";
import Spinner from "../components/Spinner";
import { mapStepsForAI } from "../lib/stepMapper";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, rectSortingStrategy } from "@dnd-kit/sortable";
import DraggableStepCard from "../components/DraggableStepCard";
import {
    MDXEditor,
    headingsPlugin,
    listsPlugin,
    quotePlugin,
    thematicBreakPlugin,
    markdownShortcutPlugin,
    toolbarPlugin,
    imagePlugin,
    linkPlugin,
    linkDialogPlugin,
    tablePlugin,
    codeBlockPlugin,
    diffSourcePlugin,
    BoldItalicUnderlineToggles,
    BlockTypeSelect,
    ListsToggle,
    UndoRedo,
    InsertImage,
    CreateLink,
    InsertTable,
    InsertThematicBreak,
    InsertCodeBlock,
    CodeToggle,
    Separator,
    DiffSourceToggleWrapper
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import ImageCropper from "../components/ImageCropper";

export default function RecordingDetail() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { currentRecording, getRecording, saveDocumentation, reorderRecordingSteps, loading } = useRecordingsStore();
    const { openaiApiKey, openaiBaseUrl, openaiModel } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<"steps" | "docs">("docs");
    const [regenerating, setRegenerating] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [croppingStepId, setCroppingStepId] = useState<string | null>(null);
    const [cropTimestamps, setCropTimestamps] = useState<Record<string, number>>({});

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

    const handleRegenerate = async () => {
        if (!currentRecording || !openaiApiKey || !id) return;

        setRegenerating(true);
        setError(null);
        try {
            const steps = mapStepsForAI(currentRecording.steps);

            const markdown = await generateDocumentation(steps, {
                apiKey: openaiApiKey,
                baseUrl: openaiBaseUrl,
                model: openaiModel,
            });

            await saveDocumentation(id, markdown);
            await getRecording(id);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Failed to regenerate documentation";
            setError(errorMessage);
        } finally {
            setRegenerating(false);
        }
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
        if (page === "dashboard") navigate('/');
        else if (page === "recordings") navigate('/recordings');
        else if (page === "settings") navigate('/settings');
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;

        if (!over || !currentRecording || !id || active.id === over.id) return;

        const steps = currentRecording.steps;
        const oldIndex = steps.findIndex(s => s.id === active.id);
        const newIndex = steps.findIndex(s => s.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
            try {
                // Reorder steps array
                const reorderedSteps = [...steps];
                const [removed] = reorderedSteps.splice(oldIndex, 1);
                reorderedSteps.splice(newIndex, 0, removed);

                // Extract step IDs in new order
                const stepIds = reorderedSteps.map(s => s.id);

                // Update in backend
                await reorderRecordingSteps(id, stepIds);
            } catch (error) {
                console.error("Failed to reorder steps:", error);
                setError(error instanceof Error ? error.message : "Failed to reorder steps");
            }
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
            <div className="flex h-screen bg-zinc-950 text-white items-center justify-center">
                <div className="text-zinc-500">Invalid recording ID</div>
            </div>
        );
    }

    if (loading && !currentRecording) {
        return (
            <div className="flex h-screen bg-zinc-950 text-white items-center justify-center">
                <div className="text-zinc-500">Loading recording...</div>
            </div>
        );
    }

    if (!currentRecording) {
        return (
            <div className="flex h-screen bg-zinc-950 text-white items-center justify-center">
                <div className="text-zinc-500">Recording not found</div>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-zinc-950 text-white">
            <Sidebar activePage="recording-detail" onNavigate={handleNavigate} />

            {/* Image Cropper Modal */}
            {croppingStep?.screenshot_path && (
                <ImageCropper
                    imageSrc={convertFileSrc(croppingStep.screenshot_path)}
                    onSave={handleCropSave}
                    onCancel={() => setCroppingStepId(null)}
                />
            )}

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center gap-4">
                        <Tooltip content="Go back">
                            <button
                                onClick={() => navigate('/recordings')}
                                className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
                            >
                                <ArrowLeft size={18} />
                            </button>
                        </Tooltip>
                        <div>
                            <h2 className="text-2xl font-bold">{currentRecording.recording.name}</h2>
                            <p className="text-sm text-zinc-500">
                                {currentRecording.steps.length} steps • Created {new Date(currentRecording.recording.created_at).toLocaleDateString()}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {activeTab === "docs" && currentRecording.recording.documentation && (
                            <>
                                {isEditing ? (
                                    <>
                                        <Tooltip content="Cancel">
                                            <button
                                                onClick={handleCancelEdit}
                                                className="p-2 hover:bg-zinc-800 rounded-md transition-colors"
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
                                                className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors"
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
                                    disabled={regenerating || !openaiApiKey}
                                    className="p-2 bg-purple-600 hover:bg-purple-700 rounded-md transition-colors disabled:opacity-50"
                                >
                                    {regenerating ? <Spinner size="sm" className="!border-white !border-t-transparent" /> : <Wand2 size={18} />}
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 mb-6 bg-zinc-900 p-1 rounded-lg w-fit">
                    <button
                        onClick={() => setActiveTab("docs")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "docs" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"
                            }`}
                    >
                        Documentation
                    </button>
                    <button
                        onClick={() => setActiveTab("steps")}
                        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === "steps" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white"
                            }`}
                    >
                        Steps
                    </button>
                </div>

                {/* Error Display */}
                {error && (
                    <div className="mb-6 p-4 bg-red-900/50 border border-red-800 rounded-lg">
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
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 print-content">
                        {currentRecording.recording.documentation ? (
                            isEditing ? (
                                <div className="mdx-editor-dark">
                                    <MDXEditor
                                        markdown={editedContent}
                                        onChange={(value) => setEditedContent(value)}
                                        plugins={[
                                            headingsPlugin(),
                                            listsPlugin(),
                                            quotePlugin(),
                                            thematicBreakPlugin(),
                                            markdownShortcutPlugin(),
                                            linkPlugin(),
                                            linkDialogPlugin(),
                                            tablePlugin(),
                                            codeBlockPlugin({ defaultCodeBlockLanguage: 'js' }),
                                            imagePlugin({
                                                imagePreviewHandler: async (imageSource) => {
                                                    // Convert local file paths to Tauri asset URLs
                                                    // Decode URI components first (e.g., %20 -> space)
                                                    const decodedSource = decodeURIComponent(imageSource);
                                                    if (decodedSource.startsWith('C:') || decodedSource.startsWith('/')) {
                                                        return Promise.resolve(convertFileSrc(decodedSource));
                                                    }
                                                    return Promise.resolve(imageSource);
                                                }
                                            }),
                                            diffSourcePlugin({ viewMode: 'rich-text' }),
                                            toolbarPlugin({
                                                toolbarContents: () => (
                                                    <DiffSourceToggleWrapper>
                                                        <UndoRedo />
                                                        <Separator />
                                                        <BlockTypeSelect />
                                                        <Separator />
                                                        <BoldItalicUnderlineToggles />
                                                        <Separator />
                                                        <ListsToggle />
                                                        <Separator />
                                                        <CreateLink />
                                                        <InsertImage />
                                                        <Separator />
                                                        <InsertTable />
                                                        <InsertThematicBreak />
                                                        <Separator />
                                                        <InsertCodeBlock />
                                                        <CodeToggle />
                                                    </DiffSourceToggleWrapper>
                                                )
                                            })
                                        ]}
                                        contentEditableClassName="prose prose-invert max-w-none min-h-[500px] p-4"
                                    />
                                </div>
                            ) : (
                                <MarkdownViewer content={currentRecording.recording.documentation} className="markdown-content" />
                            )
                        ) : (
                            <div className="text-center py-12 text-zinc-500">
                                <p>No documentation generated yet</p>
                                <button
                                    onClick={handleRegenerate}
                                    disabled={regenerating || !openaiApiKey}
                                    className="mt-4 text-purple-500 hover:text-purple-400 disabled:opacity-50 flex items-center gap-2 mx-auto"
                                >
                                    {regenerating && <Spinner size="sm" />}
                                    {regenerating ? "Generating..." : "Generate documentation"}
                                </button>
                                {!openaiApiKey && (
                                    <p className="mt-2 text-sm text-red-500">
                                        Configure your API key in Settings first
                                    </p>
                                )}
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
                            items={currentRecording.steps.map(s => s.id)}
                            strategy={rectSortingStrategy}
                        >
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {currentRecording.steps.map((step, index) => (
                                    <DraggableStepCard
                                        key={step.id}
                                        id={step.id}
                                        step={step}
                                        index={index}
                                        onCrop={() => setCroppingStepId(step.id)}
                                        onUpdateDescription={(desc) => handleUpdateDescription(step.id, desc)}
                                        cropTimestamp={cropTimestamps[step.id]}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </main>
        </div>
    );
}
