import { Trash2, Check, FolderOpen, Database, Loader2 } from "lucide-react";

export interface DeleteProgress {
    phase: 'preparing' | 'database' | 'screenshots' | 'directories' | 'complete';
    current: number;
    total: number;
    message: string;
}

interface DeleteProgressModalProps {
    isOpen: boolean;
    recordingName: string;
    progress: DeleteProgress | null;
}

export default function DeleteProgressModal({ isOpen, recordingName, progress }: DeleteProgressModalProps) {
    if (!isOpen) return null;

    const getPhaseIcon = () => {
        if (!progress) return <Loader2 size={20} className="animate-spin" />;
        
        switch (progress.phase) {
            case 'preparing':
                return <Loader2 size={20} className="animate-spin" />;
            case 'database':
                return <Database size={20} />;
            case 'screenshots':
                return <Trash2 size={20} />;
            case 'directories':
                return <FolderOpen size={20} />;
            case 'complete':
                return <Check size={20} className="text-green-400" />;
            default:
                return <Loader2 size={20} className="animate-spin" />;
        }
    };

    const getProgressPercentage = () => {
        if (!progress || progress.total === 0) return 0;
        return Math.round((progress.current / progress.total) * 100);
    };

    const isComplete = progress?.phase === 'complete';

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-surface-2 rounded-2xl shadow-2xl p-6 w-96">
                {/* Header */}
                <div className="flex items-center gap-3 mb-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        isComplete ? 'bg-green-500/20' : 'bg-red-500/20'
                    }`}>
                        {getPhaseIcon()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-semibold">
                            {isComplete ? 'Deleted' : 'Deleting Recording'}
                        </h3>
                        <p className="text-sm text-white/50 truncate" title={recordingName}>
                            {recordingName}
                        </p>
                    </div>
                </div>

                {/* Progress Bar */}
                {progress && progress.phase !== 'complete' && progress.total > 0 && (
                    <div className="mb-4">
                        <div className="flex justify-between text-xs text-white/50 mb-1">
                            <span>{progress.current} of {progress.total}</span>
                            <span>{getProgressPercentage()}%</span>
                        </div>
                        <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-[#2721E8] rounded-full transition-all duration-200"
                                style={{ width: `${getProgressPercentage()}%` }}
                            />
                        </div>
                    </div>
                )}

                {/* Status Message */}
                <div className={`text-sm ${isComplete ? 'text-green-400' : 'text-white/70'}`}>
                    {progress?.message || 'Preparing...'}
                </div>

                {/* Phase indicators */}
                {!isComplete && (
                    <div className="mt-4 pt-4 border-t border-white/10">
                        <div className="flex items-center gap-2 text-xs text-white/40">
                            <PhaseIndicator 
                                label="Database" 
                                active={progress?.phase === 'database'}
                                complete={['screenshots', 'directories', 'complete'].includes(progress?.phase || '')}
                            />
                            <span className="text-white/20">→</span>
                            <PhaseIndicator 
                                label="Screenshots" 
                                active={progress?.phase === 'screenshots'}
                                complete={['directories', 'complete'].includes(progress?.phase || '')}
                            />
                            <span className="text-white/20">→</span>
                            <PhaseIndicator 
                                label="Cleanup" 
                                active={progress?.phase === 'directories'}
                                complete={progress?.phase === 'complete'}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function PhaseIndicator({ label, active, complete }: { label: string; active: boolean; complete: boolean }) {
    return (
        <span className={`
            ${active ? 'text-[#2721E8] font-medium' : ''}
            ${complete ? 'text-green-400' : ''}
        `}>
            {complete ? '✓ ' : ''}{label}
        </span>
    );
}
