import { create } from "zustand";
import { load, Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import { getProvider, getDefaultProvider } from "../lib/providers";
import {
    WritingStyleOptions,
    ToneOption,
    AudienceOption,
    VerbosityOption,
    BrandVoiceOption,
    DEFAULT_WRITING_STYLE,
} from "../lib/promptConstants";

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
    // Structured writing style options
    writingStyle: WritingStyleOptions;
    // Rate limit mitigation settings
    enableAutoRetry: boolean;
    maxRetryAttempts: number;
    initialRetryDelayMs: number;
    enableRequestThrottling: boolean;
    throttleDelayMs: number;
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
    setWritingStyleTone: (tone: ToneOption) => void;
    setWritingStyleAudience: (audience: AudienceOption) => void;
    setWritingStyleVerbosity: (verbosity: VerbosityOption) => void;
    setWritingStyleBrandVoice: (brandVoice: BrandVoiceOption) => void;
    resetWritingStyle: () => void;
    setEnableAutoRetry: (enabled: boolean) => void;
    setMaxRetryAttempts: (attempts: number) => void;
    setInitialRetryDelayMs: (delay: number) => void;
    setEnableRequestThrottling: (enabled: boolean) => void;
    setThrottleDelayMs: (delay: number) => void;
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

// Rate limit mitigation defaults
const defaultEnableAutoRetry = true;
const defaultMaxRetryAttempts = 3;
const defaultInitialRetryDelayMs = 1000;
const defaultEnableRequestThrottling = false;
const defaultThrottleDelayMs = 500;

// Debounced auto-save mechanism
let autoSaveTimeout: ReturnType<typeof setTimeout> | null = null;
const AUTO_SAVE_DELAY_MS = 500;

function debouncedAutoSave(saveSettings: () => Promise<void>) {
    if (autoSaveTimeout) {
        clearTimeout(autoSaveTimeout);
    }
    autoSaveTimeout = setTimeout(async () => {
        try {
            await saveSettings();
            console.log("Settings auto-saved");
        } catch (error) {
            console.error("Auto-save failed:", error);
        }
    }, AUTO_SAVE_DELAY_MS);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
    aiProvider: getDefaultProvider().id,
    openaiBaseUrl: getDefaultProvider().defaultBaseUrl,
    openaiApiKey: "",
    openaiModel: getDefaultProvider().defaultModel || "",
    screenshotPath: "",
    sendScreenshotsToAi: true, // Default: send screenshots to AI
    writingStyle: { ...DEFAULT_WRITING_STYLE },
    enableAutoRetry: defaultEnableAutoRetry,
    maxRetryAttempts: defaultMaxRetryAttempts,
    initialRetryDelayMs: defaultInitialRetryDelayMs,
    enableRequestThrottling: defaultEnableRequestThrottling,
    throttleDelayMs: defaultThrottleDelayMs,
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
    setWritingStyleTone: (tone) => set((state) => ({
        writingStyle: { ...state.writingStyle, tone }
    })),
    setWritingStyleAudience: (audience) => set((state) => ({
        writingStyle: { ...state.writingStyle, audience }
    })),
    setWritingStyleVerbosity: (verbosity) => set((state) => ({
        writingStyle: { ...state.writingStyle, verbosity }
    })),
    setWritingStyleBrandVoice: (brandVoice) => set((state) => ({
        writingStyle: { ...state.writingStyle, brandVoice }
    })),
    resetWritingStyle: () => set({ writingStyle: { ...DEFAULT_WRITING_STYLE } }),
    setEnableAutoRetry: (enabled) => set({ enableAutoRetry: enabled }),
    setMaxRetryAttempts: (attempts) => set({ maxRetryAttempts: Math.max(1, Math.min(10, attempts)) }),
    setInitialRetryDelayMs: (delay) => set({ initialRetryDelayMs: Math.max(100, Math.min(5000, delay)) }),
    setEnableRequestThrottling: (enabled) => set({ enableRequestThrottling: enabled }),
    setThrottleDelayMs: (delay) => set({ throttleDelayMs: Math.max(0, Math.min(5000, delay)) }),
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
            const writingStyle = await store.get<WritingStyleOptions>("writingStyle");
            const enableAutoRetry = await store.get<boolean>("enableAutoRetry");
            const maxRetryAttempts = await store.get<number>("maxRetryAttempts");
            const initialRetryDelayMs = await store.get<number>("initialRetryDelayMs");
            const enableRequestThrottling = await store.get<boolean>("enableRequestThrottling");
            const throttleDelayMs = await store.get<number>("throttleDelayMs");
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

            // Merge loaded writing style with defaults (handles missing fields from old versions)
            const mergedWritingStyle: WritingStyleOptions = {
                ...DEFAULT_WRITING_STYLE,
                ...(writingStyle || {}),
            };

            set({
                aiProvider: aiProvider || defaultProvider.id,
                openaiBaseUrl: baseUrl || providerConfig?.defaultBaseUrl || defaultProvider.defaultBaseUrl,
                openaiApiKey: apiKey || "",
                openaiModel: model || providerConfig?.defaultModel || "",
                screenshotPath: finalScreenshotPath,
                sendScreenshotsToAi: ocrEnabled,
                writingStyle: mergedWritingStyle,
                enableAutoRetry: enableAutoRetry ?? defaultEnableAutoRetry,
                maxRetryAttempts: maxRetryAttempts ?? defaultMaxRetryAttempts,
                initialRetryDelayMs: initialRetryDelayMs ?? defaultInitialRetryDelayMs,
                enableRequestThrottling: enableRequestThrottling ?? defaultEnableRequestThrottling,
                throttleDelayMs: throttleDelayMs ?? defaultThrottleDelayMs,
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
            const { aiProvider, openaiBaseUrl, openaiApiKey, openaiModel, screenshotPath, sendScreenshotsToAi, writingStyle, enableAutoRetry, maxRetryAttempts, initialRetryDelayMs, enableRequestThrottling, throttleDelayMs, startRecordingHotkey, stopRecordingHotkey, captureHotkey } = get();

            await store.set("aiProvider", aiProvider);
            await store.set("openaiBaseUrl", openaiBaseUrl);
            await store.set("openaiApiKey", openaiApiKey);
            await store.set("openaiModel", openaiModel);
            await store.set("screenshotPath", screenshotPath);
            await store.set("sendScreenshotsToAi", sendScreenshotsToAi);
            await store.set("writingStyle", writingStyle);
            await store.set("enableAutoRetry", enableAutoRetry);
            await store.set("maxRetryAttempts", maxRetryAttempts);
            await store.set("initialRetryDelayMs", initialRetryDelayMs);
            await store.set("enableRequestThrottling", enableRequestThrottling);
            await store.set("throttleDelayMs", throttleDelayMs);
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

// Subscribe to store changes and trigger debounced auto-save
// Only auto-save after settings have been loaded initially
useSettingsStore.subscribe((state, prevState) => {
    // Don't auto-save during initial load or before settings are loaded
    if (!state.isLoaded || !prevState.isLoaded) {
        return;
    }

    // Dynamically check if any setting value changed
    // Exclude functions and isLoaded from comparison
    const settingsChanged = Object.keys(state).some((key) => {
        const value = state[key as keyof typeof state];
        // Skip functions and isLoaded flag
        if (typeof value === "function" || key === "isLoaded") {
            return false;
        }
        return value !== prevState[key as keyof typeof prevState];
    });

    if (settingsChanged) {
        debouncedAutoSave(state.saveSettings);
    }
});
