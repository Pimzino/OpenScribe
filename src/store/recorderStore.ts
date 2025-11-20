import { create } from 'zustand';

export interface Step {
    type_: string;
    x?: number;
    y?: number;
    text?: string;
    timestamp: number;
    screenshot?: string; // Base64
}

interface RecorderState {
    isRecording: boolean;
    steps: Step[];
    setIsRecording: (isRecording: boolean) => void;
    addStep: (step: Step) => void;
    clearSteps: () => void;
}

export const useRecorderStore = create<RecorderState>((set) => ({
    isRecording: false,
    steps: [],
    setIsRecording: (isRecording) => set({ isRecording }),
    addStep: (step) => set((state) => ({ steps: [...state.steps, step] })),
    clearSteps: () => set({ steps: [] }),
}));
