import { create } from "zustand";
import { load, Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";

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
    screenshotPath: string;
    startRecordingHotkey: HotkeyBinding;
    stopRecordingHotkey: HotkeyBinding;
    captureHotkey: HotkeyBinding;
    isLoaded: boolean;
    setOpenaiBaseUrl: (url: string) => void;
    setOpenaiApiKey: (key: string) => void;
    setOpenaiModel: (model: string) => void;
    setScreenshotPath: (path: string) => void;
    setStartRecordingHotkey: (hotkey: HotkeyBinding) => void;
    setStopRecordingHotkey: (hotkey: HotkeyBinding) => void;
    setCaptureHotkey: (hotkey: HotkeyBinding) => void;
    loadSettings: () => Promise<void>;
    saveSettings: () => Promise<void>;
    getDefaultScreenshotPath: () => Promise<string>;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
    if (!store) {
        store = await load("settings.json");
    }
    return store;
}

const defaultStartHotkey: HotkeyBinding = { ctrl: true, shift: false, alt: true, key: "KeyR" };
const defaultStopHotkey: HotkeyBinding = { ctrl: true, shift: false, alt: true, key: "KeyS" };
const defaultCaptureHotkey: HotkeyBinding = { ctrl: true, shift: false, alt: true, key: "KeyC" };

export const useSettingsStore = create<SettingsState>((set, get) => ({
    openaiBaseUrl: "https://api.openai.com/v1",
    openaiApiKey: "",
    openaiModel: "gpt-4o",
    screenshotPath: "",
    startRecordingHotkey: defaultStartHotkey,
    stopRecordingHotkey: defaultStopHotkey,
    captureHotkey: defaultCaptureHotkey,
    isLoaded: false,

    setOpenaiBaseUrl: (url) => set({ openaiBaseUrl: url }),
    setOpenaiApiKey: (key) => set({ openaiApiKey: key }),
    setOpenaiModel: (model) => set({ openaiModel: model }),
    setScreenshotPath: (path) => set({ screenshotPath: path }),
    setStartRecordingHotkey: (hotkey) => set({ startRecordingHotkey: hotkey }),
    setStopRecordingHotkey: (hotkey) => set({ stopRecordingHotkey: hotkey }),
    setCaptureHotkey: (hotkey) => set({ captureHotkey: hotkey }),

    getDefaultScreenshotPath: async () => {
        try {
            return await invoke<string>("get_default_screenshot_path");
        } catch (error) {
            console.error("Failed to get default screenshot path:", error);
            return "";
        }
    },

    loadSettings: async () => {
        try {
            const store = await getStore();
            const baseUrl = await store.get<string>("openaiBaseUrl");
            const apiKey = await store.get<string>("openaiApiKey");
            const model = await store.get<string>("openaiModel");
            const screenshotPath = await store.get<string>("screenshotPath");
            const startHotkey = await store.get<HotkeyBinding>("startRecordingHotkey");
            const stopHotkey = await store.get<HotkeyBinding>("stopRecordingHotkey");
            const captureHotkey = await store.get<HotkeyBinding>("captureHotkey");

            // Get default screenshot path if not set
            let finalScreenshotPath = screenshotPath || "";
            if (!finalScreenshotPath) {
                try {
                    finalScreenshotPath = await invoke<string>("get_default_screenshot_path");
                } catch {
                    finalScreenshotPath = "";
                }
            }

            // Register the screenshot path with asset protocol scope
            if (finalScreenshotPath) {
                try {
                    await invoke("register_asset_scope", { path: finalScreenshotPath });
                } catch (error) {
                    console.error("Failed to register asset scope:", error);
                }
            }

            set({
                openaiBaseUrl: baseUrl || "https://api.openai.com/v1",
                openaiApiKey: apiKey || "",
                openaiModel: model || "gpt-4o",
                screenshotPath: finalScreenshotPath,
                startRecordingHotkey: startHotkey || defaultStartHotkey,
                stopRecordingHotkey: stopHotkey || defaultStopHotkey,
                captureHotkey: captureHotkey || defaultCaptureHotkey,
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
            const { openaiBaseUrl, openaiApiKey, openaiModel, screenshotPath, startRecordingHotkey, stopRecordingHotkey, captureHotkey } = get();

            await store.set("openaiBaseUrl", openaiBaseUrl);
            await store.set("openaiApiKey", openaiApiKey);
            await store.set("openaiModel", openaiModel);
            await store.set("screenshotPath", screenshotPath);
            await store.set("startRecordingHotkey", startRecordingHotkey);
            await store.set("stopRecordingHotkey", stopRecordingHotkey);
            await store.set("captureHotkey", captureHotkey);
            await store.save();

            // Register the new screenshot path with asset protocol scope
            if (screenshotPath) {
                try {
                    await invoke("register_asset_scope", { path: screenshotPath });
                } catch (error) {
                    console.error("Failed to register asset scope:", error);
                }
            }
        } catch (error) {
            console.error("Failed to save settings:", error);
            throw error;
        }
    },
}));
