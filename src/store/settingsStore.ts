import { create } from "zustand";
import { load, Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { getProvider, getDefaultProvider } from "../lib/providers";

export interface HotkeyBinding {
    ctrl: boolean;
    shift: boolean;
    alt: boolean;
    key: string;
}

interface SettingsState {
    aiProvider: string;
    openaiBaseUrl: string;
    openaiApiKey: string;
    openaiModel: string;
    screenshotPath: string;
    sendScreenshotsToAi: boolean;
    startRecordingHotkey: HotkeyBinding;
    stopRecordingHotkey: HotkeyBinding;
    captureHotkey: HotkeyBinding;
    isLoaded: boolean;
    setAiProvider: (provider: string) => void;
    setOpenaiBaseUrl: (url: string) => void;
    setOpenaiApiKey: (key: string) => void;
    setOpenaiModel: (model: string) => void;
    setScreenshotPath: (path: string) => void;
    setSendScreenshotsToAi: (enabled: boolean) => void;
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
    aiProvider: getDefaultProvider().id,
    openaiBaseUrl: getDefaultProvider().defaultBaseUrl,
    openaiApiKey: "",
    openaiModel: getDefaultProvider().defaultModel || "",
    screenshotPath: "",
    sendScreenshotsToAi: true, // Default: send screenshots to AI
    startRecordingHotkey: defaultStartHotkey,
    stopRecordingHotkey: defaultStopHotkey,
    captureHotkey: defaultCaptureHotkey,
    isLoaded: false,

    setAiProvider: (provider) => {
        const providerConfig = getProvider(provider);
        if (providerConfig) {
            set({
                aiProvider: provider,
                openaiBaseUrl: providerConfig.defaultBaseUrl,
                openaiModel: providerConfig.defaultModel || "",
                // Clear API key when switching to provider that doesn't need it
                openaiApiKey: providerConfig.requiresApiKey ? get().openaiApiKey : "",
            });
        } else {
            set({ aiProvider: provider });
        }
    },
    setOpenaiBaseUrl: (url) => set({ openaiBaseUrl: url }),
    setOpenaiApiKey: (key) => set({ openaiApiKey: key }),
    setOpenaiModel: (model) => set({ openaiModel: model }),
    setScreenshotPath: (path) => set({ screenshotPath: path }),
    setSendScreenshotsToAi: (enabled) => set({ sendScreenshotsToAi: enabled }),
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
            const aiProvider = await store.get<string>("aiProvider");
            const baseUrl = await store.get<string>("openaiBaseUrl");
            const apiKey = await store.get<string>("openaiApiKey");
            const model = await store.get<string>("openaiModel");
            const screenshotPath = await store.get<string>("screenshotPath");
            const sendScreenshotsToAi = await store.get<boolean>("sendScreenshotsToAi");
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

            // Get provider defaults for any missing values
            const providerConfig = getProvider(aiProvider || getDefaultProvider().id);
            const defaultProvider = getDefaultProvider();

            // Sync OCR enabled state with Rust backend
            const ocrEnabled = sendScreenshotsToAi !== false; // Default to true if not set
            try {
                await invoke("set_ocr_enabled", { enabled: ocrEnabled });
            } catch (error) {
                console.error("Failed to sync OCR state with backend:", error);
            }

            set({
                aiProvider: aiProvider || defaultProvider.id,
                openaiBaseUrl: baseUrl || providerConfig?.defaultBaseUrl || defaultProvider.defaultBaseUrl,
                openaiApiKey: apiKey || "",
                openaiModel: model || providerConfig?.defaultModel || "",
                screenshotPath: finalScreenshotPath,
                sendScreenshotsToAi: ocrEnabled,
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
            const { aiProvider, openaiBaseUrl, openaiApiKey, openaiModel, screenshotPath, sendScreenshotsToAi, startRecordingHotkey, stopRecordingHotkey, captureHotkey } = get();

            await store.set("aiProvider", aiProvider);
            await store.set("openaiBaseUrl", openaiBaseUrl);
            await store.set("openaiApiKey", openaiApiKey);
            await store.set("openaiModel", openaiModel);
            await store.set("screenshotPath", screenshotPath);
            await store.set("sendScreenshotsToAi", sendScreenshotsToAi);
            await store.set("startRecordingHotkey", startRecordingHotkey);
            await store.set("stopRecordingHotkey", stopRecordingHotkey);
            await store.set("captureHotkey", captureHotkey);
            await store.save();

            // Sync OCR enabled state with Rust backend
            try {
                await invoke("set_ocr_enabled", { enabled: sendScreenshotsToAi });
            } catch (error) {
                console.error("Failed to sync OCR state with backend:", error);
            }

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
