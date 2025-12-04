import { create } from 'zustand';

export type StepStatus = 'pending' | 'generating' | 'completed' | 'error';

export interface StepProgress {
    index: number;
    status: StepStatus;
    streamingText: string;      // Current text being streamed
    completedText: string;      // Final text after completion
    error?: string;
}

interface GenerationState {
    // Generation session state
    isGenerating: boolean;
    currentStepIndex: number;
    totalSteps: number;

    // Per-step progress
    stepProgress: StepProgress[];

    // Accumulated document
    accumulatedMarkdown: string;

    // Cancellation
    abortController: AbortController | null;

    // Actions
    startGeneration: (totalSteps: number) => AbortController;
    updateStepStatus: (index: number, status: StepStatus) => void;
    appendStreamingText: (index: number, text: string) => void;
    completeStep: (index: number, finalText: string) => void;
    setStepError: (index: number, error: string) => void;
    updateDocument: (markdown: string) => void;
    cancelGeneration: () => void;
    resetGeneration: () => void;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
    isGenerating: false,
    currentStepIndex: -1,
    totalSteps: 0,
    stepProgress: [],
    accumulatedMarkdown: '',
    abortController: null,

    startGeneration: (totalSteps: number) => {
        const abortController = new AbortController();
        const stepProgress: StepProgress[] = Array.from({ length: totalSteps }, (_, i) => ({
            index: i,
            status: 'pending',
            streamingText: '',
            completedText: '',
        }));

        set({
            isGenerating: true,
            currentStepIndex: 0,
            totalSteps,
            stepProgress,
            accumulatedMarkdown: '',
            abortController,
        });

        return abortController;
    },

    updateStepStatus: (index: number, status: StepStatus) => {
        set(state => ({
            currentStepIndex: status === 'generating' ? index : state.currentStepIndex,
            stepProgress: state.stepProgress.map((sp, i) =>
                i === index ? { ...sp, status } : sp
            ),
        }));
    },

    appendStreamingText: (index: number, text: string) => {
        set(state => ({
            stepProgress: state.stepProgress.map((sp, i) =>
                i === index ? { ...sp, streamingText: sp.streamingText + text } : sp
            ),
        }));
    },

    completeStep: (index: number, finalText: string) => {
        set(state => ({
            stepProgress: state.stepProgress.map((sp, i) =>
                i === index ? { ...sp, status: 'completed', completedText: finalText, streamingText: '' } : sp
            ),
        }));
    },

    setStepError: (index: number, error: string) => {
        set(state => ({
            stepProgress: state.stepProgress.map((sp, i) =>
                i === index ? { ...sp, status: 'error', error } : sp
            ),
        }));
    },

    updateDocument: (markdown: string) => {
        set({ accumulatedMarkdown: markdown });
    },

    cancelGeneration: () => {
        const { abortController } = get();
        abortController?.abort();
        set({ isGenerating: false, abortController: null });
    },

    resetGeneration: () => {
        set({
            isGenerating: false,
            currentStepIndex: -1,
            totalSteps: 0,
            stepProgress: [],
            accumulatedMarkdown: '',
            abortController: null,
        });
    },
}));
