import { create } from "zustand";
import { load, Store } from "@tauri-apps/plugin-store";

export interface HotkeyBinding {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    key: string;
}

interface SettingsState {
    openaiBaseUrl: string;
    openaiApiKey: string;
    openaiModel: string;
    startRecordingHotkey: HotkeyBinding;
    stopRecordingHotkey: HotkeyBinding;
    isLoaded: boolean;
    setOpenaiBaseUrl: (url: string) => void;
    setOpenaiApiKey: (key: string) => void;
    setOpenaiModel: (model: string) => void;
    setStartRecordingHotkey: (hotkey: HotkeyBinding) => void;
    setStopRecordingHotkey: (hotkey: HotkeyBinding) => void;
    loadSettings: () => Promise<void>;
    saveSettings: () => Promise<void>;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
    if (!store) {
        store = await load("settings.json", { autoSave: false });
    }
    return store;
}

const defaultStartHotkey: HotkeyBinding = { ctrl: true, shift: false, alt: true, key: "KeyR" };
const defaultStopHotkey: HotkeyBinding = { ctrl: true, shift: false, alt: true, key: "KeyS" };

export const useSettingsStore = create<SettingsState>((set, get) => ({
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiApiKey: "",
    openaiModel: "gpt-4o",
    startRecordingHotkey: defaultStartHotkey,
    stopRecordingHotkey: defaultStopHotkey,
    isLoaded: false,

    setOpenaiBaseUrl: (url) => set({ openaiBaseUrl: url }),
    setOpenaiApiKey: (key) => set({ openaiApiKey: key }),
    setOpenaiModel: (model) => set({ openaiModel: model }),
    setStartRecordingHotkey: (hotkey) => set({ startRecordingHotkey: hotkey }),
    setStopRecordingHotkey: (hotkey) => set({ stopRecordingHotkey: hotkey }),

    loadSettings: async () => {
        try {
            const store = await getStore();
            const baseUrl = await store.get<string>("openaiBaseUrl");
            const apiKey = await store.get<string>("openaiApiKey");
            const model = await store.get<string>("openaiModel");
            const startHotkey = await store.get<HotkeyBinding>("startRecordingHotkey");
            const stopHotkey = await store.get<HotkeyBinding>("stopRecordingHotkey");

            set({
                openaiBaseUrl: baseUrl || "https://api.openai.com/v1",
                openaiApiKey: apiKey || "",
                openaiModel: model || "gpt-4o",
                startRecordingHotkey: startHotkey || defaultStartHotkey,
                stopRecordingHotkey: stopHotkey || defaultStopHotkey,
                isLoaded: true,
            });
        } catch (error) {
            console.error("Failed to load settings:", error);
            set({ isLoaded: true });
        }
    },

    saveSettings: async () => {
        try {
            const store = await getStore();
            const { openaiBaseUrl, openaiApiKey, openaiModel, startRecordingHotkey, stopRecordingHotkey } = get();

            await store.set("openaiBaseUrl", openaiBaseUrl);
            await store.set("openaiApiKey", openaiApiKey);
            await store.set("openaiModel", openaiModel);
            await store.set("startRecordingHotkey", startRecordingHotkey);
            await store.set("stopRecordingHotkey", stopRecordingHotkey);
            await store.save();
        } catch (error) {
            console.error("Failed to save settings:", error);
            throw error;
        }
    },
}));
