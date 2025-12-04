import { XCircle } from 'lucide-react';
import { useGenerationStore } from '../../store/generationStore';
import StepProgressCard from './StepProgressCard';
import StreamingMarkdownViewer from './StreamingMarkdownViewer';

interface StepLike {
    type_: string;
    element_name?: string;
    text?: string;
    screenshot?: string;
}

interface GenerationSplitViewProps {
    steps: StepLike[];
    onCancel: () => void;
}

export default function GenerationSplitView({ steps, onCancel }: GenerationSplitViewProps) {
    const {
        isGenerating,
        stepProgress,
        accumulatedMarkdown,
        currentStepIndex,
        totalSteps,
    } = useGenerationStore();

    const completedCount = stepProgress.filter(sp => sp.status === 'completed').length;
    const progressPercent = totalSteps > 0 ? Math.round((completedCount / totalSteps) * 100) : 0;

    return (
        <div className="flex h-full gap-4">
            {/* Left Panel - Step Progress */}
            <div className="w-1/3 flex flex-col overflow-hidden min-w-[280px]">
                <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <h3 className="text-lg font-semibold text-white">
                        Generation Progress
                    </h3>
                    <span className="text-sm text-white/50">
                        {completedCount}/{totalSteps} steps
                    </span>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 bg-white/10 rounded-full mb-4 flex-shrink-0 overflow-hidden">
                    <div
                        className="h-full bg-[#2721E8] rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${progressPercent}%` }}
                    />
                </div>

                {/* Step cards */}
                <div className="flex-1 overflow-y-auto space-y-3 p-1 mr-1">
                    {stepProgress.map((sp, index) => (
                        <StepProgressCard
                            key={index}
                            step={steps[index] || { type_: 'unknown' }}
                            progress={sp}
                            isActive={index === currentStepIndex && isGenerating}
                        />
                    ))}
                </div>

                {/* Cancel button */}
                {isGenerating && (
                    <button
                        onClick={onCancel}
                        className="mt-4 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg transition-colors flex-shrink-0"
                    >
                        <XCircle size={18} />
                        <span>Cancel Generation</span>
                    </button>
                )}
            </div>

            {/* Divider */}
            <div className="w-px bg-white/10 flex-shrink-0" />

            {/* Right Panel - Streaming Document */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <h3 className="text-lg font-semibold text-white mb-4 flex-shrink-0">
                    Documentation Preview
                </h3>
                <div className="flex-1 overflow-hidden glass-surface-2 p-6 rounded-xl">
                    <StreamingMarkdownViewer
                        content={accumulatedMarkdown}
                        isGenerating={isGenerating}
                    />
                </div>
            </div>
        </div>
    );
}
