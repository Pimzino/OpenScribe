import { FileText, Code } from 'lucide-react';

export type ViewMode = 'rich' | 'source';

interface SourceModeToggleProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

export function SourceModeToggle({
  viewMode,
  onViewModeChange,
}: SourceModeToggleProps) {
  return (
    <div className="flex bg-[rgba(22,19,22,0.75)] rounded-md border border-white/10 p-0.5">
      <button
        onClick={() => onViewModeChange('rich')}
        type="button"
        className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-all ${
          viewMode === 'rich'
            ? 'bg-[rgba(39,33,232,0.3)] text-white'
            : 'text-white/60 hover:text-white hover:bg-white/5'
        }`}
        title="Rich Text View"
      >
        <FileText size={14} />
        <span>Rich Text</span>
      </button>
      <button
        onClick={() => onViewModeChange('source')}
        type="button"
        className={`px-3 py-1.5 rounded text-sm flex items-center gap-1.5 transition-all ${
          viewMode === 'source'
            ? 'bg-[rgba(39,33,232,0.3)] text-white'
            : 'text-white/60 hover:text-white hover:bg-white/5'
        }`}
        title="Source View (Markdown)"
      >
        <Code size={14} />
        <span>Source</span>
      </button>
    </div>
  );
}

export default SourceModeToggle;
