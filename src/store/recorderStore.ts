import { create } from 'zustand';

export interface Step {
    type_: string;
    x?: number;
    y?: number;
    text?: string;
    timestamp: number;
    screenshot?: string; // File path
    element_name?: string;
    element_type?: string;
    element_value?: string;
    app_name?: string;
}

interface RecorderState {
    isRecording: boolean;
    steps: Step[];
    setIsRecording: (isRecording: boolean) => void;
    addStep: (step: Step) => void;
    removeStep: (index: number) => void;
    clearSteps: () => void;
}

export const useRecorderStore = create<RecorderState>((set) => ({
    isRecording: false,
    steps: [],
    setIsRecording: (isRecording) => set({ isRecording }),
    addStep: (step) => set((state) => ({ steps: [...state.steps, step] })),
    removeStep: (index) => set((state) => ({ steps: state.steps.filter((_, i) => i !== index) })),
    clearSteps: () => set({ steps: [] }),
}));
