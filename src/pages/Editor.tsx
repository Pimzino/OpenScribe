import { useState, useEffect } from "react";
import { useRecorderStore } from "../store/recorderStore";
import { generateDocumentation } from "../lib/aiService";
import { ArrowLeft, Copy, Check } from "lucide-react";

interface EditorProps {
    onBack: () => void;
}

export default function Editor({ onBack }: EditorProps) {
    const { steps } = useRecorderStore();
    const [markdown, setMarkdown] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const generate = async () => {
            try {
                setError(null);
                const docs = await generateDocumentation(steps);
                setMarkdown(docs);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to generate documentation");
            } finally {
                setLoading(false);
            }
        };
        generate();
    }, [steps]);

    const copyToClipboard = () => {
        navigator.clipboard.writeText(markdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="flex h-screen bg-zinc-950 text-white flex-col">
            <header className="border-b border-zinc-800 p-4 flex items-center justify-between bg-zinc-900">
                <div className="flex items-center gap-4">
                    <button
                        onClick={onBack}
                        className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <h1 className="text-lg font-bold">Generated Documentation</h1>
                </div>

                <button
                    onClick={copyToClipboard}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md text-sm font-medium transition-colors"
                    disabled={loading}
                >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                    {copied ? "Copied" : "Copy Markdown"}
                </button>
            </header>

            <main className="flex-1 p-8 overflow-auto">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-4">
                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                        <p>Generating documentation with AI...</p>
                        <p className="text-xs">Processing {steps.length} steps...</p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center h-full gap-4">
                        <div className="bg-red-900/50 border border-red-800 rounded-lg p-6 max-w-md text-center">
                            <p className="text-red-400 font-medium mb-2">Error</p>
                            <p className="text-sm text-zinc-300">{error}</p>
                        </div>
                        <button
                            onClick={onBack}
                            className="text-sm text-zinc-400 hover:text-white transition-colors"
                        >
                            Go back and try again
                        </button>
                    </div>
                ) : (
                    <div className="max-w-3xl mx-auto bg-zinc-900 p-8 rounded-lg border border-zinc-800 shadow-lg">
                        <pre className="whitespace-pre-wrap font-mono text-sm text-zinc-300">
                            {markdown}
                        </pre>
                    </div>
                )}
            </main>
        </div>
    );
}
