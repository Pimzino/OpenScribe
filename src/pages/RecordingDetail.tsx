import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
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

export default function RecordingDetail() {
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const { currentRecording, getRecording, saveDocumentation, loading } = useRecordingsStore();
    const { openaiApiKey, openaiBaseUrl, openaiModel } = useSettingsStore();
    const [activeTab, setActiveTab] = useState<"steps" | "docs">("docs");
    const [regenerating, setRegenerating] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editedContent, setEditedContent] = useState("");
    const [error, setError] = useState<string | null>(null);

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
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {currentRecording.steps.map((step, index) => (
                            <div key={step.id} className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
                                {step.screenshot_path && (
                                    <div className="aspect-video bg-zinc-950 relative">
                                        <img
                                            src={convertFileSrc(step.screenshot_path)}
                                            alt={`Step ${index + 1}`}
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute top-2 left-2 bg-black/50 px-2 py-1 rounded text-xs">
                                            {new Date(step.timestamp).toLocaleTimeString()}
                                        </div>
                                    </div>
                                )}
                                <div className="p-4">
                                    <h3 className="font-medium text-sm text-zinc-300">
                                        Step {index + 1} ({step.type_ === "click" ? "Click" : "Type"})
                                    </h3>
                                    {step.type_ === "click" ? (
                                        <p className="text-xs text-zinc-500 mt-1">
                                            Clicked at ({step.x}, {step.y})
                                        </p>
                                    ) : (
                                        <div className="mt-2 bg-zinc-950 p-2 rounded border border-zinc-800 font-mono text-xs text-blue-400 break-words">
                                            "{step.text}"
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
