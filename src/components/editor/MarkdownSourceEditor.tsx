import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

interface MarkdownSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  minHeight?: string;
  className?: string;
}

export function MarkdownSourceEditor({
  value,
  onChange,
  minHeight = '500px',
  className = '',
}: MarkdownSourceEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const isExternalUpdate = useRef(false);

  // Custom dark theme matching the app's glassmorphism design
  const customTheme = EditorView.theme({
    '&': {
      backgroundColor: '#161316',
      color: 'rgba(255, 255, 255, 0.9)',
      height: '100%',
    },
    '.cm-content': {
      caretColor: 'white',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: '14px',
      padding: '16px',
      lineHeight: '1.6',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(22, 19, 22, 0.75)',
      color: 'rgba(255, 255, 255, 0.5)',
      border: 'none',
      borderRight: '1px solid rgba(255, 255, 255, 0.1)',
    },
    '.cm-gutter': {
      minWidth: '3em',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.05)',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(39, 33, 232, 0.3) !important',
    },
    '.cm-cursor': {
      borderLeftColor: 'white',
      borderLeftWidth: '2px',
    },
    '.cm-scroller': {
      overflow: 'auto',
    },
    // Markdown syntax highlighting
    '.cm-header': {
      color: '#4a45f5',
      fontWeight: 'bold',
    },
    '.cm-header-1': {
      fontSize: '1.5em',
    },
    '.cm-header-2': {
      fontSize: '1.3em',
    },
    '.cm-header-3': {
      fontSize: '1.1em',
    },
    '.cm-link': {
      color: '#49B8D3',
    },
    '.cm-url': {
      color: '#49B8D3',
      textDecoration: 'underline',
    },
    '.cm-string': {
      color: '#4ade80',
    },
    '.cm-comment': {
      color: 'rgba(255, 255, 255, 0.4)',
    },
    '.cm-meta': {
      color: '#c084fc',
    },
    '.cm-keyword': {
      color: '#f472b6',
    },
    '.cm-strong': {
      fontWeight: 'bold',
      color: 'white',
    },
    '.cm-em': {
      fontStyle: 'italic',
    },
    '.cm-strikethrough': {
      textDecoration: 'line-through',
    },
    '.cm-monospace': {
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
    },
  });

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && !isExternalUpdate.current) {
        const newValue = update.state.doc.toString();
        onChange(newValue);
      }
    });

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        markdown(),
        customTheme,
        oneDark,
        updateListener,
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
      ],
    });

    editorRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      editorRef.current?.destroy();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes to editor
  useEffect(() => {
    if (!editorRef.current) return;

    const currentValue = editorRef.current.state.doc.toString();
    if (currentValue !== value) {
      isExternalUpdate.current = true;
      editorRef.current.dispatch({
        changes: {
          from: 0,
          to: currentValue.length,
          insert: value,
        },
      });
      isExternalUpdate.current = false;
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={`overflow-auto ${className}`}
      style={{ minHeight }}
    />
  );
}

export default MarkdownSourceEditor;
