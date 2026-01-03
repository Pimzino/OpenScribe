import { useState, useCallback, useRef, useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Markdown } from 'tiptap-markdown';
import { common, createLowlight } from 'lowlight';

// Extend Editor type to include getMarkdown from tiptap-markdown
declare module '@tiptap/react' {
  interface Editor {
    getMarkdown: () => string;
  }
}

import { TauriImage } from './extensions/TauriImage';
import { TiptapToolbar } from './TiptapToolbar';
import { SourceModeToggle, ViewMode } from './SourceModeToggle';
import { MarkdownSourceEditor } from './MarkdownSourceEditor';

// Create lowlight instance with common languages
const lowlight = createLowlight(common);

export type ToolbarGroup = 'history' | 'heading' | 'format' | 'list' | 'insert' | 'code';

interface TiptapEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  minHeight?: string;
  showSourceToggle?: boolean;
  toolbarGroups?: ToolbarGroup[];
  className?: string;
}

export function TiptapEditor({
  content,
  onChange,
  placeholder = 'Start writing documentation...',
  minHeight = '500px',
  showSourceToggle = true,
  toolbarGroups = ['history', 'heading', 'format', 'list', 'insert', 'code'],
  className = '',
}: TiptapEditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('rich');
  const [sourceContent, setSourceContent] = useState(content);
  const [isToolbarStuck, setIsToolbarStuck] = useState(false);
  const lastSyncedContent = useRef(content);
  const isInternalUpdate = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    // Prevent React 18 Strict Mode from causing duplicate extension warnings
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false, // Using CodeBlockLowlight instead
      }),
      // Add Link and Underline BEFORE Markdown so Markdown uses our configured versions
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-[#49B8D3] underline hover:text-[#5fc5e0]',
        },
      }),
      Underline,
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      TauriImage.configure({
        inline: false,
        allowBase64: true,
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'javascript',
      }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    editorProps: {
      attributes: {
        class: 'prose prose-invert max-w-none focus:outline-none',
        style: `min-height: ${minHeight}; padding: 1rem;`,
      },
    },
    onUpdate: ({ editor }) => {
      if (viewMode === 'rich' && !isInternalUpdate.current) {
        // Check if getMarkdown is available (Markdown extension may not be ready yet)
        if (typeof editor.getMarkdown === 'function') {
          const markdownContent = editor.getMarkdown();
          lastSyncedContent.current = markdownContent;
          onChange(markdownContent);
        }
      }
    },
  });

  // Handle view mode switching
  const handleViewModeChange = (newMode: ViewMode) => {
    if (newMode === viewMode) return;
    if (!editor) {
      console.warn('Editor not ready');
      return;
    }

    if (newMode === 'source') {
      // Switching TO source mode: get markdown from editor
      try {
        const markdownContent = editor.getMarkdown();
        setSourceContent(markdownContent);
        lastSyncedContent.current = markdownContent;
      } catch (err) {
        console.error('Failed to get markdown:', err);
        // Fall back to current content
        setSourceContent(content);
      }
    } else {
      // Switching TO rich mode: parse source markdown into editor
      if (sourceContent !== lastSyncedContent.current) {
        isInternalUpdate.current = true;
        editor.commands.setContent(sourceContent);
        isInternalUpdate.current = false;
        lastSyncedContent.current = sourceContent;
        onChange(sourceContent);
      }
    }

    setViewMode(newMode);
  };

  // Handle source editor changes
  const handleSourceChange = useCallback(
    (newContent: string) => {
      setSourceContent(newContent);
      onChange(newContent);
    },
    [onChange]
  );

  // Sync external content changes (e.g., when switching recordings)
  useEffect(() => {
    if (editor && content !== lastSyncedContent.current) {
      isInternalUpdate.current = true;
      editor.commands.setContent(content);
      isInternalUpdate.current = false;
      setSourceContent(content);
      lastSyncedContent.current = content;
    }
  }, [content, editor]);

  // Detect when toolbar becomes sticky
  useEffect(() => {
    const toolbar = toolbarRef.current;
    const container = containerRef.current;
    if (!toolbar || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // When the sentinel (top of container) is not visible, toolbar is stuck
        setIsToolbarStuck(!entry.isIntersecting);
      },
      {
        threshold: 0,
        rootMargin: '-1px 0px 0px 0px',
      }
    );

    // Create a sentinel element at the top of the container
    const sentinel = document.createElement('div');
    sentinel.style.height = '1px';
    sentinel.style.marginBottom = '-1px';
    container.insertBefore(sentinel, container.firstChild);

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
      sentinel.remove();
    };
  }, []);

  if (!editor) {
    return (
      <div
        className="animate-pulse bg-white/5 rounded-xl"
        style={{ minHeight }}
      />
    );
  }

  return (
    <div ref={containerRef} className={`tiptap-editor-dark rounded-xl border border-white/10 ${className}`}>
      {/* Toolbar - sticky on scroll, floats when pinned */}
      <div
        ref={toolbarRef}
        style={{
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1), margin 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-radius 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        className={`sticky top-0 z-10 flex items-center justify-between gap-2 p-2 backdrop-blur-md sticky-optimized ${
          isToolbarStuck
            ? 'mx-6 mt-3 rounded-xl bg-[rgba(22,19,22,0.98)] border border-[#2721E8]/50 shadow-[0_4px_20px_rgba(39,33,232,0.3)]'
            : 'mx-0 mt-0 rounded-t-xl rounded-b-none bg-[rgba(22,19,22,0.95)] border-b border-transparent border-b-white/10 shadow-none'
        }`}
      >
        <TiptapToolbar
          editor={editor}
          groups={toolbarGroups}
          disabled={viewMode === 'source'}
        />
        {showSourceToggle && (
          <SourceModeToggle
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
          />
        )}
      </div>

      {/* Editor Content */}
      <div className="bg-[#161316] rounded-b-xl scroll-optimized" style={{ minHeight }}>
        {viewMode === 'rich' ? (
          <EditorContent editor={editor} className="tiptap-content" />
        ) : (
          <MarkdownSourceEditor
            value={sourceContent}
            onChange={handleSourceChange}
            minHeight={minHeight}
          />
        )}
      </div>
    </div>
  );
}

export default TiptapEditor;
