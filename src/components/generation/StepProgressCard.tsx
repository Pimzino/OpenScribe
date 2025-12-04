import { Clock, Loader2, CheckCircle2, XCircle, MousePointer, Keyboard, Camera } from 'lucide-react';
import { StepProgress } from '../../store/generationStore';

interface StepLike {
    type_: string;
    element_name?: string;
    text?: string;
}

interface StepProgressCardProps {
    step: StepLike;
    progress: StepProgress;
    isActive: boolean;
}

const statusIcons = {
    pending: Clock,
    generating: Loader2,
    completed: CheckCircle2,
    error: XCircle,
};

const statusColors = {
    pending: 'text-white/40',
    generating: 'text-blue-400',
    completed: 'text-green-400',
    error: 'text-red-400',
};

const typeIcons = {
    click: MousePointer,
    type: Keyboard,
    capture: Camera,
};

const typeLabels = {
    click: 'Click',
    type: 'Type',
    capture: 'Capture',
};

export default function StepProgressCard({ step, progress, isActive }: StepProgressCardProps) {
    const StatusIcon = statusIcons[progress.status];
    const TypeIcon = typeIcons[step.type_ as keyof typeof typeIcons] || Camera;
    const typeLabel = typeLabels[step.type_ as keyof typeof typeLabels] || 'Action';

    return (
        <div className={`
            glass-surface-2 rounded-lg p-3 transition-all duration-200
            ${isActive ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}
            ${progress.status === 'completed' ? 'opacity-70' : ''}
            ${progress.status === 'error' ? 'ring-1 ring-red-500/50' : ''}
        `}>
            <div className="flex items-center gap-2 mb-2">
                <StatusIcon
                    size={16}
                    className={`${statusColors[progress.status]} ${
                        progress.status === 'generating' ? 'animate-spin' : ''
                    }`}
                />
                <span className="text-sm font-medium text-white">
                    Step {progress.index + 1}
                </span>
                <div className="flex items-center gap-1 text-xs text-white/50">
                    <TypeIcon size={12} />
                    <span>{typeLabel}</span>
                </div>
            </div>

            {/* Show element name or text preview for context */}
            {(step.element_name || step.text) && progress.status === 'pending' && (
                <p className="text-xs text-white/40 truncate mb-1">
                    {step.type_ === 'type' ? `"${step.text}"` : step.element_name}
                </p>
            )}

            {/* Show streaming text for active step */}
            {progress.status === 'generating' && progress.streamingText && (
                <div className="text-sm text-white/70 italic">
                    {progress.streamingText}
                    <span className="animate-pulse text-blue-400">|</span>
                </div>
            )}

            {/* Show completed text */}
            {progress.status === 'completed' && progress.completedText && (
                <p className="text-sm text-white/60 line-clamp-2">
                    {progress.completedText}
                </p>
            )}

            {/* Show error */}
            {progress.status === 'error' && progress.error && (
                <p className="text-sm text-red-400 line-clamp-2">
                    {progress.error}
                </p>
            )}
        </div>
    );
}
