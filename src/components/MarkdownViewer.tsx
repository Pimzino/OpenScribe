import ReactMarkdown from "react-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";

interface MarkdownViewerProps {
    content: string;
    className?: string;
}

export default function MarkdownViewer({ content, className }: MarkdownViewerProps) {
    return (
        <div className={className}>
            <ReactMarkdown
                urlTransform={(url) => url}
                components={{
                    h1: ({ children }) => <h1 className="text-2xl font-bold mb-4 mt-6">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-xl font-semibold mb-3 mt-5">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-lg font-medium mb-2 mt-4">{children}</h3>,
                    p: ({ children }) => <p className="mb-4 text-zinc-300">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc pl-6 mb-4">{children}</ul>,
                    ol: ({ children }) => <ol className="list-decimal pl-6 mb-4">{children}</ol>,
                    li: ({ children }) => <li className="mb-1">{children}</li>,
                    code: ({ children }) => <code className="bg-zinc-800 px-1 py-0.5 rounded text-sm">{children}</code>,
                    pre: ({ children }) => <pre className="bg-zinc-800 p-4 rounded mb-4 overflow-x-auto">{children}</pre>,
                    img: ({ src, alt }) => (
                        <img
                            src={src ? convertFileSrc(decodeURIComponent(src)) : ''}
                            alt={alt || ''}
                            className="max-w-full rounded my-4"
                        />
                    ),
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
