import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

import { useToastStore } from './toastStore';

export interface Recording {
    id: string;
    name: string;
    created_at: number;
    updated_at: number;
    documentation: string | null;
    documentation_generated_at: number | null;
    step_count: number;
}

export interface Step {
    id: string;
    recording_id: string;
    type_: string;
    x?: number;
    y?: number;
    text?: string;
    timestamp: number;
    screenshot_path?: string;
    element_name?: string;
    element_type?: string;
    element_value?: string;
    app_name?: string;
    order_index: number;
    description?: string;
    is_cropped?: boolean;
    ocr_text?: string;
    ocr_status?: string;
}

export interface RecordingWithSteps {
    recording: Recording;
    steps: Step[];
}

export interface Statistics {
    total_recordings: number;
    total_steps: number;
    recordings_this_week: number;
    recent_recordings: Recording[];
}

export interface StepInput {
    type_: string;
    x?: number;
    y?: number;
    text?: string;
    timestamp: number;
    screenshot?: string;
    element_name?: string;
    element_type?: string;
    element_value?: string;
    app_name?: string;
    description?: string;
    is_cropped?: boolean;
}

interface RecordingsState {
    recordings: Recording[];
    currentRecording: RecordingWithSteps | null;
    statistics: Statistics | null;
    loading: boolean;
    error: string | null;

    // Actions
    fetchRecordings: () => Promise<void>;
    refreshRecordings: () => Promise<void>;
    fetchStatistics: () => Promise<void>;
    createRecording: (name: string) => Promise<string>;
    saveSteps: (recordingId: string, steps: StepInput[]) => Promise<void>;
    saveStepsWithPath: (recordingId: string, recordingName: string, steps: StepInput[], screenshotPath?: string) => Promise<void>;
    saveDocumentation: (recordingId: string, documentation: string) => Promise<void>;
    getRecording: (id: string) => Promise<RecordingWithSteps | null>;
    deleteRecording: (id: string) => Promise<void>;
    updateRecordingName: (id: string, name: string) => Promise<void>;
    reorderRecordingSteps: (recordingId: string, stepIds: string[]) => Promise<void>;
    updateStepOcr: (stepId: string, ocrText: string | null, ocrStatus: string) => Promise<void>;
    setCurrentRecording: (recording: RecordingWithSteps | null) => void;
    clearError: () => void;
}

export const useRecordingsStore = create<RecordingsState>((set, get) => ({
    recordings: [],
    currentRecording: null,
    statistics: null,
    loading: false,
    error: null,

    fetchRecordings: async () => {
        set({ loading: true, error: null });
        try {
            const recordings = await invoke<Recording[]>('list_recordings');
            set({ recordings, loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
        }
    },

    refreshRecordings: async () => {
        set({ error: null });
        try {
            const recordings = await invoke<Recording[]>('list_recordings');
            set({ recordings });
        } catch {
            // Ignore background refresh failures
        }
    },

    fetchStatistics: async () => {
        set({ loading: true, error: null });
        try {
            const statistics = await invoke<Statistics>('get_statistics');
            set({ statistics, loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
        }
    },

    createRecording: async (name: string) => {
        set({ loading: true, error: null });
        try {
            const id = await invoke<string>('create_recording', { name });
            await get().fetchRecordings();
            set({ loading: false });
            return id;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    saveSteps: async (recordingId: string, steps: StepInput[]) => {
        set({ loading: true, error: null });
        try {
            await invoke('save_steps', { recordingId, steps });
            await get().fetchRecordings();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    saveStepsWithPath: async (recordingId: string, recordingName: string, steps: StepInput[], screenshotPath?: string) => {
        set({ loading: true, error: null });
        try {
            await invoke('save_steps_with_path', {
                recordingId,
                recordingName,
                steps,
                screenshotPath: screenshotPath || null
            });
            await get().fetchRecordings();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    saveDocumentation: async (recordingId: string, documentation: string) => {
        set({ loading: true, error: null });
        try {
            await invoke('save_documentation', { recordingId, documentation });
            await get().fetchRecordings();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    getRecording: async (id: string) => {
        set({ loading: true, error: null });
        try {
            const recording = await invoke<RecordingWithSteps | null>('get_recording', { id });
            set({ currentRecording: recording, loading: false });
            return recording;
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    deleteRecording: async (id: string) => {
        const previousRecordings = get().recordings;

        set({ recordings: previousRecordings.filter((r) => r.id !== id), error: null });
        if (get().currentRecording?.recording.id === id) {
            set({ currentRecording: null });
        }

        const deletingToastId = useToastStore.getState().showToast({
            message: "Deleting recording…",
            variant: "info",
            durationMs: 60000,
        });

        try {
            await invoke('delete_recording', { id });

            useToastStore.getState().dismissToast(deletingToastId);
            useToastStore.getState().showToast({
                message: "Recording deleted",
                variant: "success",
            });

            // Fire-and-forget refresh to stay in sync with backend
            get().refreshRecordings().catch(() => undefined);
        } catch (error) {
            useToastStore.getState().dismissToast(deletingToastId);

            set({ recordings: previousRecordings, error: String(error) });
            useToastStore.getState().showToast({
                message: "Failed to delete recording",
                variant: "error",
            });

            throw error;
        }
    },

    updateRecordingName: async (id: string, name: string) => {
        set({ loading: true, error: null });
        try {
            await invoke('update_recording_name', { id, name });
            await get().fetchRecordings();
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
            throw error;
        }
    },

    reorderRecordingSteps: async (recordingId: string, stepIds: string[]) => {
        set({ error: null });
        try {
            await invoke('reorder_steps', { recordingId, stepIds });
            // Refresh recording to get updated order
            await get().getRecording(recordingId);
        } catch (error) {
            set({ error: error instanceof Error ? error.message : "Failed to reorder steps" });
            throw error;
        }
    },

    updateStepOcr: async (stepId: string, ocrText: string | null, ocrStatus: string) => {
        try {
            await invoke('update_step_ocr', { stepId, ocrText, ocrStatus });
            // Update local state if we have a current recording
            const currentRecording = get().currentRecording;
            if (currentRecording) {
                const updatedSteps = currentRecording.steps.map(step =>
                    step.id === stepId
                        ? { ...step, ocr_text: ocrText ?? undefined, ocr_status: ocrStatus }
                        : step
                );
                set({
                    currentRecording: {
                        ...currentRecording,
                        steps: updatedSteps
                    }
                });
            }
        } catch (error) {
            console.error('Failed to update step OCR:', error);
        }
    },

    setCurrentRecording: (recording: RecordingWithSteps | null) => {
        set({ currentRecording: recording });
    },

    clearError: () => {
        set({ error: null });
    },
}));
