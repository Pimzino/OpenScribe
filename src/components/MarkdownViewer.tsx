import React, { useState, useMemo, memo } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Expand } from "lucide-react";
import ImageViewer from "./ImageViewer";

interface MarkdownViewerProps {
    content: string;
    className?: string;
}

interface MarkdownImageProps {
    src?: string;
    alt?: string;
}

const MarkdownImage = memo(function MarkdownImage({ src, alt }: MarkdownImageProps) {
    const [isViewerOpen, setIsViewerOpen] = useState(false);
    const imageSrc = useMemo(
        () => src ? convertFileSrc(decodeURIComponent(src)) : '',
        [src]
    );

    return (
        <>
            {isViewerOpen && createPortal(
                <ImageViewer
                    imageSrc={imageSrc}
                    title={alt || 'Image'}
                    onClose={() => setIsViewerOpen(false)}
                />,
                document.body
            )}
            <span className="relative inline-block my-4 group">
                <img
                    src={imageSrc}
                    alt={alt || ''}
                    loading="lazy"
                    decoding="async"
                    className="max-w-full max-h-80 w-auto h-auto object-contain rounded"
                />
                <button
                    onClick={() => setIsViewerOpen(true)}
                    className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                    <Expand size={14} className="text-white" />
                </button>
            </span>
        </>
    );
});

const markdownComponents = {
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-2xl font-bold mb-4 mt-6">{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-xl font-semibold mb-3 mt-5">{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-lg font-medium mb-2 mt-4">{children}</h3>,
    p: ({ children }: { children?: React.ReactNode }) => <p className="mb-4 text-white/70">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-6 mb-4">{children}</ul>,
    ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-6 mb-4">{children}</ol>,
    li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1">{children}</li>,
    code: ({ children }: { children?: React.ReactNode }) => <code className="bg-[#161316] px-1 py-0.5 rounded text-sm text-[#49B8D3]">{children}</code>,
    pre: ({ children }: { children?: React.ReactNode }) => <pre className="bg-[#161316] p-4 rounded mb-4 overflow-x-auto">{children}</pre>,
    img: ({ src, alt }: { src?: string; alt?: string }) => <MarkdownImage src={src} alt={alt} />,
};

const urlTransform = (url: string) => url;

export default memo(function MarkdownViewer({ content, className }: MarkdownViewerProps) {
    return (
        <div className={className}>
            <ReactMarkdown
                urlTransform={urlTransform}
                components={markdownComponents}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
});
