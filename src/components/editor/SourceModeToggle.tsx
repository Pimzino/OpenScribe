import { FileText, Code } from 'lucide-react';
import Tooltip from '../Tooltip';

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
    <div className="flex bg-[rgba(22,19,22,0.75)] rounded-lg border border-white/10 p-1">
      <Tooltip content="Rich Text" position="top">
        <button
          onClick={() => onViewModeChange('rich')}
          type="button"
          className={`p-1.5 rounded-md flex items-center justify-center transition-all ${
            viewMode === 'rich'
              ? 'bg-[rgba(39,33,232,0.4)] text-white'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <FileText size={14} />
        </button>
      </Tooltip>
      <Tooltip content="Source (Markdown)" position="top">
        <button
          onClick={() => onViewModeChange('source')}
          type="button"
          className={`p-1.5 rounded-md flex items-center justify-center transition-all ${
            viewMode === 'source'
              ? 'bg-[rgba(39,33,232,0.4)] text-white'
              : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
        >
          <Code size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

export default SourceModeToggle;
