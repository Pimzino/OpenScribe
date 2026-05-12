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
    recordingId: string | null;  // Track which recording this generation is for

    // Per-step progress
    stepProgress: StepProgress[];

    // Accumulated document
    accumulatedMarkdown: string;

    // Coherence pass (final document-wide refinement)
    isPolishing: boolean;

    // Cancellation
    abortController: AbortController | null;

    // Actions
    startGeneration: (recordingId: string, totalSteps: number) => AbortController;
    updateStepStatus: (index: number, status: StepStatus) => void;
    appendStreamingText: (index: number, text: string) => void;
    completeStep: (index: number, finalText: string) => void;
    setStepError: (index: number, error: string) => void;
    updateDocument: (markdown: string) => void;
    startPolishing: () => void;
    finishPolishing: (refinedDescriptions: string[]) => void;
    finishGeneration: () => void;
    cancelGeneration: () => void;
    resetGeneration: () => void;
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
    isGenerating: false,
    currentStepIndex: -1,
    totalSteps: 0,
    recordingId: null,
    stepProgress: [],
    accumulatedMarkdown: '',
    isPolishing: false,
    abortController: null,

    startGeneration: (recordingId: string, totalSteps: number) => {
        const abortController = new AbortController();
        const stepProgress: StepProgress[] = Array.from({ length: totalSteps }, (_, i) => ({
            index: i,
            status: 'pending',
            streamingText: '',
            completedText: '',
        }));

        set({
            recordingId,
            isGenerating: true,
            currentStepIndex: 0,
            totalSteps,
            stepProgress,
            accumulatedMarkdown: '',
            isPolishing: false,
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

    startPolishing: () => {
        set({ isPolishing: true });
    },

    finishPolishing: (refinedDescriptions: string[]) => {
        set(state => ({
            isPolishing: false,
            stepProgress: state.stepProgress.map((sp, i) => {
                const refined = refinedDescriptions[i];
                return refined ? { ...sp, completedText: refined } : sp;
            }),
        }));
    },

    finishGeneration: () => {
        set({ isGenerating: false, isPolishing: false });
    },

    cancelGeneration: () => {
        const { abortController } = get();
        abortController?.abort();
        set({ isGenerating: false, isPolishing: false, abortController: null });
    },

    resetGeneration: () => {
        set({
            isGenerating: false,
            currentStepIndex: -1,
            totalSteps: 0,
            recordingId: null,
            stepProgress: [],
            accumulatedMarkdown: '',
            isPolishing: false,
            abortController: null,
        });
    },
}));
