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
    description?: string;
    is_cropped?: boolean;
}

interface RecorderState {
    isRecording: boolean;
    steps: Step[];
    setIsRecording: (isRecording: boolean) => void;
    addStep: (step: Step) => void;
    removeStep: (index: number) => void;
    clearSteps: () => void;
    updateStepDescription: (index: number, description: string) => void;
    updateStepScreenshot: (index: number, screenshot: string, is_cropped: boolean) => void;
    reorderSteps: (sourceIndex: number, destinationIndex: number) => void;
}

export const useRecorderStore = create<RecorderState>((set) => ({
    isRecording: false,
    steps: [],
    setIsRecording: (isRecording) => set({ isRecording }),
    addStep: (step) => set((state) => ({ steps: [...state.steps, step] })),
    removeStep: (index) => set((state) => ({ steps: state.steps.filter((_, i) => i !== index) })),
    clearSteps: () => set({ steps: [] }),
    updateStepDescription: (index, description) => set((state) => ({
        steps: state.steps.map((step, i) =>
            i === index ? { ...step, description } : step
        )
    })),
    updateStepScreenshot: (index, screenshot, is_cropped) => set((state) => ({
        steps: state.steps.map((step, i) =>
            i === index ? { ...step, screenshot, is_cropped } : step
        )
    })),
    reorderSteps: (sourceIndex, destinationIndex) => set((state) => {
        const newSteps = [...state.steps];
        const [removed] = newSteps.splice(sourceIndex, 1);
        newSteps.splice(destinationIndex, 0, removed);
        return { steps: newSteps };
    }),
}));
