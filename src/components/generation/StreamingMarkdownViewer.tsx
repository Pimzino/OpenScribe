import { useRef, useEffect, useState } from 'react';
import { ArrowDown, Loader2 } from 'lucide-react';
import MarkdownViewer from '../MarkdownViewer';

interface StreamingMarkdownViewerProps {
    content: string;
    isGenerating?: boolean;
}

export default function StreamingMarkdownViewer({ content, isGenerating = false }: StreamingMarkdownViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [autoScroll, setAutoScroll] = useState(true);

    // Auto-scroll to bottom when content updates
    useEffect(() => {
        if (autoScroll && containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [content, autoScroll]);

    // Detect manual scroll to disable auto-scroll
    // Only update state when value changes to prevent unnecessary re-renders
    const handleScroll = () => {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
        setAutoScroll(prev => prev !== isAtBottom ? isAtBottom : prev);
    };

    const scrollToBottom = () => {
        setAutoScroll(true);
        containerRef.current?.scrollTo({
            top: containerRef.current.scrollHeight,
            behavior: 'smooth'
        });
    };

    return (
        <div className="relative h-full">
            <div
                ref={containerRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto pr-2"
            >
                {content ? (
                    <MarkdownViewer content={content} className="markdown-content" />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-white/40">
                        <Loader2 className="animate-spin mb-3" size={28} />
                        <p className="text-sm">Waiting for generation to start...</p>
                    </div>
                )}

                {/* Generating indicator at bottom */}
                {isGenerating && content && (
                    <div className="flex items-center gap-2 text-white/50 text-sm py-4">
                        <Loader2 className="animate-spin" size={14} />
                        <span>Generating...</span>
                    </div>
                )}
            </div>

            {/* Scroll-to-bottom button when auto-scroll is disabled */}
            {!autoScroll && (
                <button
                    onClick={scrollToBottom}
                    className="absolute bottom-4 right-4 p-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-full shadow-lg transition-colors"
                    title="Scroll to bottom"
                >
                    <ArrowDown size={16} className="text-white" />
                </button>
            )}
        </div>
    );
}
