import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export interface Recording {
    id: string;
    name: string;
    created_at: number;
    updated_at: number;
    documentation: string | null;
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
}

interface RecordingsState {
    recordings: Recording[];
    currentRecording: RecordingWithSteps | null;
    statistics: Statistics | null;
    loading: boolean;
    error: string | null;

    // Actions
    fetchRecordings: () => Promise<void>;
    fetchStatistics: () => Promise<void>;
    createRecording: (name: string) => Promise<string>;
    saveSteps: (recordingId: string, steps: StepInput[]) => Promise<void>;
    saveDocumentation: (recordingId: string, documentation: string) => Promise<void>;
    getRecording: (id: string) => Promise<RecordingWithSteps | null>;
    deleteRecording: (id: string) => Promise<void>;
    updateRecordingName: (id: string, name: string) => Promise<void>;
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
        set({ loading: true, error: null });
        try {
            await invoke('delete_recording', { id });
            await get().fetchRecordings();
            if (get().currentRecording?.recording.id === id) {
                set({ currentRecording: null });
            }
            set({ loading: false });
        } catch (error) {
            set({ error: String(error), loading: false });
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

    setCurrentRecording: (recording: RecordingWithSteps | null) => {
        set({ currentRecording: recording });
    },

    clearError: () => {
        set({ error: null });
    },
}));
