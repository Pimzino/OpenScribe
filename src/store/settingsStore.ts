import { create } from "zustand";
import { load, Store } from "@tauri-apps/plugin-store";

interface SettingsState {
    openaiBaseUrl: string;
    openaiApiKey: string;
    openaiModel: string;
    isLoaded: boolean;
    setOpenaiBaseUrl: (url: string) => void;
    setOpenaiApiKey: (key: string) => void;
    setOpenaiModel: (model: string) => void;
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

export const useSettingsStore = create<SettingsState>((set, get) => ({
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiApiKey: "",
    openaiModel: "gpt-4o",
    isLoaded: false,

    setOpenaiBaseUrl: (url) => set({ openaiBaseUrl: url }),
    setOpenaiApiKey: (key) => set({ openaiApiKey: key }),
    setOpenaiModel: (model) => set({ openaiModel: model }),

    loadSettings: async () => {
        try {
            const store = await getStore();
            const baseUrl = await store.get<string>("openaiBaseUrl");
            const apiKey = await store.get<string>("openaiApiKey");
            const model = await store.get<string>("openaiModel");

            set({
                openaiBaseUrl: baseUrl || "https://api.openai.com/v1",
                openaiApiKey: apiKey || "",
                openaiModel: model || "gpt-4o",
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
            const { openaiBaseUrl, openaiApiKey, openaiModel } = get();

            await store.set("openaiBaseUrl", openaiBaseUrl);
            await store.set("openaiApiKey", openaiApiKey);
            await store.set("openaiModel", openaiModel);
            await store.save();
        } catch (error) {
            console.error("Failed to save settings:", error);
            throw error;
        }
    },
}));
