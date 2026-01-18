import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useSettingsStore, HotkeyBinding } from "../store/settingsStore";
import { Save, Eye, EyeOff, FolderOpen, RotateCcw, ChevronDown, RefreshCw, Check, X, ExternalLink } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import Sidebar from "../components/Sidebar";
import Spinner from "../components/Spinner";
import Tooltip from "../components/Tooltip";
import { PROVIDERS, getProvider, testConnection, fetchModels } from "../lib/providers";
import {
    TONE_OPTIONS,
    AUDIENCE_OPTIONS,
    VERBOSITY_OPTIONS,
    BRAND_VOICE_OPTIONS,
} from "../lib/promptConstants";

export default function Settings() {
    const navigate = useNavigate();
    const {
        aiProvider,
        openaiBaseUrl,
        openaiApiKey,
        openaiModel,
        screenshotPath,
        sendScreenshotsToAi,
        writingStyle,
        enableAutoRetry,
        maxRetryAttempts,
        initialRetryDelayMs,
        enableRequestThrottling,
        throttleDelayMs,
        startRecordingHotkey,
        stopRecordingHotkey,
        captureHotkey,
        setAiProvider,
        setOpenaiBaseUrl,
        setOpenaiApiKey,
        setOpenaiModel,
        setScreenshotPath,
        setSendScreenshotsToAi,
        setWritingStyleTone,
        setWritingStyleAudience,
        setWritingStyleVerbosity,
        setWritingStyleBrandVoice,
        resetWritingStyle,
        setEnableAutoRetry,
        setMaxRetryAttempts,
        setInitialRetryDelayMs,
        setEnableRequestThrottling,
        setThrottleDelayMs,
        setStartRecordingHotkey,
        setStopRecordingHotkey,
        setCaptureHotkey,
        saveSettings,
        loadSettings,
        isLoaded,
        getDefaultScreenshotPath,
    } = useSettingsStore();

    const [showApiKey, setShowApiKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [capturingHotkey, setCapturingHotkey] = useState<"start" | "stop" | "capture" | null>(null);
    const [pathError, setPathError] = useState<string | null>(null);
    const [validatingPath, setValidatingPath] = useState(false);
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<{ testing: boolean; success?: boolean; message?: string }>({ testing: false });
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [guidelinesExpanded, setGuidelinesExpanded] = useState(false);

    const currentProvider = getProvider(aiProvider);

    const validateApiKey = (key: string): string | null => {
        // Skip validation if provider doesn't require API key
        if (!currentProvider?.requiresApiKey) return null;
        if (!key) return "API key is required for this provider";
        // Only validate OpenAI key format for OpenAI provider
        if (aiProvider === 'openai') {
            if (!key.startsWith("sk-")) return "OpenAI API key must start with 'sk-'";
            if (key.length < 20) return "API key seems too short";
        }
        return null;
    };

    const handleTestConnection = async () => {
        setConnectionStatus({ testing: true });
        const result = await testConnection(
            openaiBaseUrl,
            openaiApiKey,
            currentProvider?.requiresApiKey ?? true
        );
        setConnectionStatus({
            testing: false,
            success: result.success,
            message: result.message,
        });
        if (result.models && result.models.length > 0) {
            setAvailableModels(result.models);
        }
    };

    const handleFetchModels = async () => {
        setFetchingModels(true);
        const models = await fetchModels(
            openaiBaseUrl,
            openaiApiKey,
            currentProvider?.requiresApiKey ?? true
        );
        setAvailableModels(models);
        setFetchingModels(false);
        if (models.length > 0) {
            setModelDropdownOpen(true);
        }
    };

    const handleProviderChange = (providerId: string) => {
        setAiProvider(providerId);
        setProviderDropdownOpen(false);
        setConnectionStatus({ testing: false });
        setAvailableModels([]);
        setApiKeyError(null);
    };

    const areHotkeysEqual = (a: HotkeyBinding, b: HotkeyBinding): boolean => {
        return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
    };

    const handleBrowseFolder = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "Select Screenshot Storage Location",
            });
            if (selected && typeof selected === "string") {
                setScreenshotPath(selected);
                validatePath(selected);
            }
        } catch (error) {
            console.error("Failed to open folder dialog:", error);
        }
    };

    const handleResetPath = async () => {
        const defaultPath = await getDefaultScreenshotPath();
        if (defaultPath) {
            setScreenshotPath(defaultPath);
            setPathError(null);
        }
    };

    const validatePath = async (path: string) => {
        if (!path) {
            setPathError(null);
            return;
        }
        setValidatingPath(true);
        try {
            await invoke("validate_screenshot_path", { path });
            setPathError(null);
        } catch (error) {
            setPathError(error as string);
        } finally {
            setValidatingPath(false);
        }
    };

    const formatHotkey = (hotkey: HotkeyBinding): string => {
        const parts: string[] = [];
        if (hotkey.ctrl) parts.push("Ctrl");
        if (hotkey.shift) parts.push("Shift");
        if (hotkey.alt) parts.push("Alt");
        // Convert KeyR to R, KeyS to S, etc.
        const keyName = hotkey.key.replace("Key", "").replace("Digit", "");
        parts.push(keyName);
        return parts.join(" + ");
    };

    const handleHotkeyCapture = (e: React.KeyboardEvent, type: "start" | "stop" | "capture") => {
        e.preventDefault();
        if (e.key === "Escape") {
            setCapturingHotkey(null);
            return;
        }
        // Ignore modifier-only keys
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) {
            return;
        }
        const hotkey: HotkeyBinding = {
            ctrl: e.ctrlKey,
            shift: e.shiftKey,
            alt: e.altKey,
            key: e.code,
        };
        if (type === "start") {
            setStartRecordingHotkey(hotkey);
        } else if (type === "stop") {
            setStopRecordingHotkey(hotkey);
        } else {
            setCaptureHotkey(hotkey);
        }
        setCapturingHotkey(null);
    };

    const getHotkeyWarning = (hotkey: HotkeyBinding): string | null => {
        const key = hotkey.key;

        // Problematic Ctrl+Shift combinations (browser shortcuts)
        if (hotkey.ctrl && hotkey.shift && !hotkey.alt) {
            if (key === "KeyR") return "Conflicts with browser hard reload";
            if (key === "KeyI") return "Conflicts with browser dev tools";
            if (key === "KeyJ") return "Conflicts with browser downloads";
            if (key === "KeyN") return "Conflicts with incognito window";
        }

        // Problematic Ctrl combinations
        if (hotkey.ctrl && !hotkey.shift && !hotkey.alt) {
            if (key === "KeyW") return "Conflicts with close tab";
            if (key === "KeyT") return "Conflicts with new tab";
            if (key === "KeyN") return "Conflicts with new window";
            if (key === "KeyQ") return "Conflicts with quit application";
        }

        // Problematic Alt combinations
        if (hotkey.alt && !hotkey.ctrl && !hotkey.shift) {
            if (key === "F4") return "Conflicts with close window";
        }

        // Require at least one modifier
        if (!hotkey.ctrl && !hotkey.shift && !hotkey.alt) {
            return "Hotkey should include at least one modifier (Ctrl, Shift, or Alt)";
        }

        return null;
    };

    const startWarning = getHotkeyWarning(startRecordingHotkey);
    const stopWarning = getHotkeyWarning(stopRecordingHotkey);
    const captureWarning = getHotkeyWarning(captureHotkey);
    const hotkeysMatch = areHotkeysEqual(startRecordingHotkey, stopRecordingHotkey) ||
        areHotkeysEqual(startRecordingHotkey, captureHotkey) ||
        areHotkeysEqual(stopRecordingHotkey, captureHotkey);

    useEffect(() => {
        if (!isLoaded) {
            loadSettings();
        }
    }, [isLoaded, loadSettings]);

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('[data-dropdown="provider"]')) {
                setProviderDropdownOpen(false);
            }
            if (!target.closest('[data-dropdown="model"]')) {
                setModelDropdownOpen(false);
            }
        };
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveSettings();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error("Failed to save settings:", error);
        } finally {
            setSaving(false);
        }
    };

    const handleNavigate = (page: "recordings" | "settings") => {
        if (page === "recordings") navigate("/");
    };

    return (
        <div className="flex h-screen text-white">
            <Sidebar activePage="settings" onNavigate={handleNavigate} />

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="max-w-2xl">
                    <h2 className="text-2xl font-bold mb-8">Settings</h2>

                    <div className="space-y-6">
                        {/* Storage Section */}
                        <div>
                            <h3 className="text-lg font-medium text-zinc-200 mb-4">Storage</h3>

                            {/* Screenshot Path */}
                            <div>
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    Screenshot Storage Location
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={screenshotPath}
                                        onChange={(e) => {
                                            setScreenshotPath(e.target.value);
                                            validatePath(e.target.value);
                                        }}
                                        placeholder="Select a folder..."
                                        className={`flex-1 px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-white placeholder-white/50 focus:outline-none transition-colors ${
                                            pathError
                                                ? "border-red-600 focus:border-red-500"
                                                : "border-white/10 focus:border-[#2721E8]"
                                        }`}
                                    />
                                    <Tooltip content="Browse for folder" position="top">
                                        <button
                                            onClick={handleBrowseFolder}
                                            className="px-3 py-2 bg-white/10 border border-white/10 rounded-md hover:bg-white/15 transition-colors"
                                        >
                                            <FolderOpen size={16} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip content="Reset to default" position="top">
                                        <button
                                            onClick={handleResetPath}
                                            className="px-3 py-2 bg-white/10 border border-white/10 rounded-md hover:bg-white/15 transition-colors"
                                        >
                                            <RotateCcw size={16} />
                                        </button>
                                    </Tooltip>
                                </div>
                                {pathError && (
                                    <p className="mt-1 text-xs text-red-500">{pathError}</p>
                                )}
                                {validatingPath && (
                                    <p className="mt-1 text-xs text-white/50">Validating path...</p>
                                )}
                                <p className="mt-1 text-xs text-white/50">
                                    Screenshots will be saved in subfolders named after each recording
                                </p>
                            </div>
                        </div>

                        {/* AI Section */}
                        <div className="border-t border-white/8 pt-6">
                            <h3 className="text-lg font-medium text-white/80 mb-4">AI</h3>
                        </div>

                        {/* Provider Dropdown */}
                        <div data-dropdown="provider">
                            <label className="block text-sm font-medium text-white/80 mb-2">
                                Provider
                            </label>
                            <div className="relative">
                                <button
                                    onClick={() => setProviderDropdownOpen(!providerDropdownOpen)}
                                    className="w-full px-4 py-2 glass-surface-3 rounded-xl text-white text-left flex items-center justify-between hover:border-white/15 focus:outline-none focus:border-[#2721E8] transition-colors"
                                >
                                    <span>{currentProvider?.name || 'Select provider'}</span>
                                    <ChevronDown size={16} className={`transition-transform ${providerDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>
                                {providerDropdownOpen && (
                                    <div className="absolute z-10 w-full mt-1 glass-surface-3 rounded-xl shadow-lg max-h-60 overflow-y-auto">
                                        {PROVIDERS.map((provider) => (
                                            <button
                                                key={provider.id}
                                                onClick={() => handleProviderChange(provider.id)}
                                                className={`w-full px-4 py-2 text-left hover:bg-white/10 transition-colors ${
                                                    aiProvider === provider.id ? 'bg-[#2721E8]/20 text-[#49B8D3]' : 'text-white'
                                                }`}
                                            >
                                                <div className="font-medium">{provider.name}</div>
                                                {provider.helpText && (
                                                    <div className="text-xs text-white/50 mt-0.5">{provider.helpText}</div>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            {currentProvider?.helpUrl && (
                                <a
                                    href={currentProvider.helpUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-1 text-xs text-[#49B8D3] hover:text-[#5fc5e0] inline-flex items-center gap-1"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        openUrl(currentProvider.helpUrl!);
                                    }}
                                >
                                    Learn more <ExternalLink size={10} />
                                </a>
                            )}
                        </div>

                        {/* Base URL */}
                        <div>
                            <label className="block text-sm font-medium text-white/80 mb-2">
                                Base URL
                            </label>
                            <input
                                type="url"
                                value={openaiBaseUrl}
                                onChange={(e) => {
                                    setOpenaiBaseUrl(e.target.value);
                                    setConnectionStatus({ testing: false });
                                }}
                                placeholder={currentProvider?.defaultBaseUrl || "https://api.example.com/v1"}
                                className="w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border border-white/10 rounded-md text-white placeholder-white/50 focus:outline-none focus:border-[#2721E8] transition-colors"
                            />
                            <p className="mt-1 text-xs text-white/50">
                                API endpoint for the selected provider
                            </p>
                        </div>

                        {/* Model ID with Refresh */}
                        <div data-dropdown="model">
                            <label className="block text-sm font-medium text-white/80 mb-2">
                                Model
                            </label>
                            <div className="relative">
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <input
                                            type="text"
                                            value={openaiModel}
                                            onChange={(e) => {
                                                setOpenaiModel(e.target.value);
                                                // Show dropdown with filtered results as user types
                                                if (availableModels.length > 0) {
                                                    setModelDropdownOpen(true);
                                                }
                                            }}
                                            onFocus={() => {
                                                // Auto-fetch models on focus if we don't have any yet
                                                if (availableModels.length === 0 && openaiBaseUrl) {
                                                    handleFetchModels();
                                                }
                                                if (availableModels.length > 0) {
                                                    setModelDropdownOpen(true);
                                                }
                                            }}
                                            placeholder={currentProvider?.defaultModel || "model-name"}
                                            className="w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border border-white/10 rounded-md text-white placeholder-white/50 focus:outline-none focus:border-[#2721E8] transition-colors"
                                        />
                                        {modelDropdownOpen && availableModels.length > 0 && (
                                            <div className="absolute z-10 w-full mt-1 glass-surface-3 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                                                {availableModels
                                                    .filter(model =>
                                                        !openaiModel ||
                                                        model.toLowerCase().includes(openaiModel.toLowerCase())
                                                    )
                                                    .map((model) => (
                                                        <button
                                                            key={model}
                                                            onClick={() => {
                                                                setOpenaiModel(model);
                                                                setModelDropdownOpen(false);
                                                            }}
                                                            className={`w-full px-4 py-2 text-left hover:bg-white/10 transition-colors text-sm ${
                                                                openaiModel === model ? 'bg-[#2721E8]/20 text-[#49B8D3]' : 'text-white'
                                                            }`}
                                                        >
                                                            {model}
                                                        </button>
                                                    ))}
                                                {availableModels.filter(model =>
                                                    !openaiModel ||
                                                    model.toLowerCase().includes(openaiModel.toLowerCase())
                                                ).length === 0 && (
                                                    <div className="px-4 py-2 text-sm text-white/50">
                                                        No matching models
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {fetchingModels && (
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                <Spinner size="sm" />
                                            </div>
                                        )}
                                    </div>
                                    <Tooltip content="Refresh models list" position="top">
                                        <button
                                            onClick={handleFetchModels}
                                            disabled={fetchingModels || !openaiBaseUrl}
                                            className="px-3 py-2 bg-white/10 border border-white/10 rounded-md hover:bg-white/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <RefreshCw size={16} className={fetchingModels ? 'animate-spin' : ''} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                            <p className="mt-1 text-xs text-white/50">
                                {currentProvider?.supportsVision
                                    ? "Use a vision-capable model for best results (e.g., gpt-4o, llava, claude-3)"
                                    : "Model to use for generation"
                                }
                            </p>
                        </div>

                        {/* API Key - Only show if provider requires it */}
                        {currentProvider?.requiresApiKey && (
                            <div>
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    API Key
                                </label>
                                <div className="relative">
                                    <input
                                        type={showApiKey ? "text" : "password"}
                                        value={openaiApiKey}
                                        onChange={(e) => {
                                            setOpenaiApiKey(e.target.value);
                                            setApiKeyError(validateApiKey(e.target.value));
                                            setConnectionStatus({ testing: false });
                                        }}
                                        placeholder={aiProvider === 'openai' ? "sk-..." : "Enter API key"}
                                        className={`w-full px-4 py-2 pr-10 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-white placeholder-white/50 focus:outline-none transition-colors ${
                                            apiKeyError
                                                ? "border-red-600 focus:border-red-500"
                                                : "border-white/10 focus:border-[#2721E8]"
                                        }`}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white/70"
                                    >
                                        {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                                {apiKeyError && (
                                    <p className="mt-1 text-xs text-red-500">{apiKeyError}</p>
                                )}
                                <p className="mt-1 text-xs text-white/50">
                                    Your API key is stored securely on your device
                                </p>
                            </div>
                        )}

                        {/* Test Connection Button */}
                        <div>
                            <button
                                onClick={handleTestConnection}
                                disabled={connectionStatus.testing || !openaiBaseUrl}
                                className="flex items-center gap-2 px-4 py-2 bg-white/10 border border-white/10 rounded-md hover:bg-white/15 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {connectionStatus.testing ? (
                                    <>
                                        <Spinner size="sm" />
                                        Testing...
                                    </>
                                ) : (
                                    <>
                                        <RefreshCw size={16} />
                                        Test Connection
                                    </>
                                )}
                            </button>
                            {connectionStatus.message && (
                                <div className={`mt-2 flex items-center gap-2 text-sm ${
                                    connectionStatus.success ? 'text-green-500' : 'text-red-500'
                                }`}>
                                    {connectionStatus.success ? <Check size={16} /> : <X size={16} />}
                                    {connectionStatus.message}
                                </div>
                            )}
                        </div>

                        {/* Send Screenshots to AI Toggle */}
                        <div className="mt-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <label className="block text-sm font-medium text-white/80">
                                        Send Screenshots to AI
                                    </label>
                                    <p className="text-xs text-white/50 mt-1">
                                        When disabled, AI receives OCR text and metadata only (no images)
                                    </p>
                                </div>
                                <button
                                    onClick={() => setSendScreenshotsToAi(!sendScreenshotsToAi)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        sendScreenshotsToAi ? 'bg-[#2721E8]' : 'bg-white/20'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            sendScreenshotsToAi ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>
                        </div>

                        {/* Rate Limit Mitigation Section */}
                        <div className="mt-6 border-t border-white/8 pt-6">
                            <h4 className="text-sm font-medium text-white/80 mb-2">
                                Rate Limit Mitigation
                            </h4>
                            <p className="text-xs text-white/50 mb-4">
                                Configure how the app handles API rate limits during documentation generation.
                            </p>

                            {/* Auto-Retry Toggle */}
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-white/80">
                                        Auto-Retry on Rate Limit
                                    </label>
                                    <p className="text-xs text-white/50 mt-1">
                                        Automatically retry requests when rate limited (HTTP 429)
                                    </p>
                                </div>
                                <button
                                    onClick={() => setEnableAutoRetry(!enableAutoRetry)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        enableAutoRetry ? 'bg-[#2721E8]' : 'bg-white/20'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            enableAutoRetry ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* Auto-Retry Settings (shown when enabled) */}
                            {enableAutoRetry && (
                                <div className="ml-4 space-y-4 mb-6 p-4 bg-white/5 rounded-lg">
                                    {/* Max Retry Attempts */}
                                    <div>
                                        <label className="block text-sm font-medium text-white/60 mb-2">
                                            Max Retry Attempts
                                        </label>
                                        <div className="flex items-center gap-4">
                                            <input
                                                type="range"
                                                min="1"
                                                max="10"
                                                value={maxRetryAttempts}
                                                onChange={(e) => setMaxRetryAttempts(parseInt(e.target.value))}
                                                className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#2721E8]"
                                            />
                                            <span className="text-sm text-white/80 w-8 text-center">{maxRetryAttempts}</span>
                                        </div>
                                    </div>

                                    {/* Initial Retry Delay */}
                                    <div>
                                        <label className="block text-sm font-medium text-white/60 mb-2">
                                            Initial Retry Delay
                                        </label>
                                        <div className="flex items-center gap-4">
                                            <input
                                                type="range"
                                                min="100"
                                                max="5000"
                                                step="100"
                                                value={initialRetryDelayMs}
                                                onChange={(e) => setInitialRetryDelayMs(parseInt(e.target.value))}
                                                className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#2721E8]"
                                            />
                                            <span className="text-sm text-white/80 w-16 text-right">{initialRetryDelayMs}ms</span>
                                        </div>
                                        <p className="text-xs text-white/40 mt-1">
                                            Delay doubles with each retry (exponential backoff)
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Request Throttling Toggle */}
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <label className="block text-sm font-medium text-white/80">
                                        Request Throttling
                                    </label>
                                    <p className="text-xs text-white/50 mt-1">
                                        Add delay between API calls to prevent hitting rate limits
                                    </p>
                                </div>
                                <button
                                    onClick={() => setEnableRequestThrottling(!enableRequestThrottling)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        enableRequestThrottling ? 'bg-[#2721E8]' : 'bg-white/20'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                            enableRequestThrottling ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* Throttle Delay Settings (shown when enabled) */}
                            {enableRequestThrottling && (
                                <div className="ml-4 p-4 bg-white/5 rounded-lg">
                                    <label className="block text-sm font-medium text-white/60 mb-2">
                                        Delay Between Requests
                                    </label>
                                    <div className="flex items-center gap-4">
                                        <input
                                            type="range"
                                            min="0"
                                            max="5000"
                                            step="100"
                                            value={throttleDelayMs}
                                            onChange={(e) => setThrottleDelayMs(parseInt(e.target.value))}
                                            className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#2721E8]"
                                        />
                                        <span className="text-sm text-white/80 w-16 text-right">{throttleDelayMs}ms</span>
                                    </div>
                                    <p className="text-xs text-white/40 mt-1">
                                        {throttleDelayMs === 0 ? 'No delay between requests' :
                                         `Adds ${(throttleDelayMs / 1000).toFixed(1)}s between each API call`}
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Writing Style - Collapsible Section */}
                        <div className="mt-6 border-t border-white/8 pt-6">
                            <button
                                onClick={() => setGuidelinesExpanded(!guidelinesExpanded)}
                                className="w-full flex items-center justify-between text-left"
                            >
                                <div>
                                    <h4 className="text-sm font-medium text-white/80">
                                        Writing Style
                                    </h4>
                                    <p className="text-xs text-white/50 mt-1">
                                        Customize how the AI writes step descriptions
                                    </p>
                                </div>
                                <ChevronDown
                                    size={16}
                                    className={`text-white/50 transition-transform ${guidelinesExpanded ? 'rotate-180' : ''}`}
                                />
                            </button>

                            {guidelinesExpanded && (
                                <div className="mt-4 space-y-4">
                                    {/* Tone */}
                                    <div>
                                        <label className="block text-sm font-medium text-white/60 mb-2">
                                            Tone
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {TONE_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setWritingStyleTone(option.value)}
                                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                                        writingStyle.tone === option.value
                                                            ? 'bg-[#2721E8] text-white'
                                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                                    }`}
                                                >
                                                    <div className="font-medium">{option.label}</div>
                                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Audience */}
                                    <div>
                                        <label className="block text-sm font-medium text-white/60 mb-2">
                                            Audience
                                        </label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {AUDIENCE_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setWritingStyleAudience(option.value)}
                                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                                        writingStyle.audience === option.value
                                                            ? 'bg-[#2721E8] text-white'
                                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                                    }`}
                                                >
                                                    <div className="font-medium">{option.label}</div>
                                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Detail Level */}
                                    <div>
                                        <label className="block text-sm font-medium text-white/60 mb-2">
                                            Detail Level
                                        </label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {VERBOSITY_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setWritingStyleVerbosity(option.value)}
                                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                                        writingStyle.verbosity === option.value
                                                            ? 'bg-[#2721E8] text-white'
                                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                                    }`}
                                                >
                                                    <div className="font-medium">{option.label}</div>
                                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Brand Voice */}
                                    <div>
                                        <label className="block text-sm font-medium text-white/60 mb-2">
                                            Brand Voice
                                        </label>
                                        <div className="grid grid-cols-3 gap-2">
                                            {BRAND_VOICE_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={() => setWritingStyleBrandVoice(option.value)}
                                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                                        writingStyle.brandVoice === option.value
                                                            ? 'bg-[#2721E8] text-white'
                                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                                    }`}
                                                >
                                                    <div className="font-medium">{option.label}</div>
                                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Reset button */}
                                    <div className="flex justify-end pt-2">
                                        <button
                                            onClick={resetWritingStyle}
                                            className="text-xs text-[#49B8D3] hover:text-[#5fc5e0] transition-colors flex items-center gap-1"
                                        >
                                            <RotateCcw size={12} />
                                            Reset to Defaults
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Hotkeys Section */}
                        <div className="border-t border-white/8 pt-6 mt-6">
                            <h3 className="text-lg font-medium text-white/80 mb-4">Keyboard Shortcuts</h3>

                            {/* Start Recording Hotkey */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    Start Recording
                                </label>
                                <button
                                    onClick={() => setCapturingHotkey("start")}
                                    onKeyDown={(e) => capturingHotkey === "start" && handleHotkeyCapture(e, "start")}
                                    className={`w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-left font-mono text-sm transition-colors ${
                                        capturingHotkey === "start"
                                            ? "border-[#2721E8] text-[#49B8D3]"
                                            : startWarning
                                            ? "border-yellow-600 text-white hover:border-yellow-500"
                                            : "border-white/10 text-white hover:border-white/20"
                                    }`}
                                >
                                    {capturingHotkey === "start" ? "Press keys..." : formatHotkey(startRecordingHotkey)}
                                </button>
                                {startWarning && (
                                    <p className="mt-1 text-xs text-yellow-500">{startWarning}</p>
                                )}
                            </div>

                            {/* Stop Recording Hotkey */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    Stop Recording
                                </label>
                                <button
                                    onClick={() => setCapturingHotkey("stop")}
                                    onKeyDown={(e) => capturingHotkey === "stop" && handleHotkeyCapture(e, "stop")}
                                    className={`w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-left font-mono text-sm transition-colors ${
                                        capturingHotkey === "stop"
                                            ? "border-[#2721E8] text-[#49B8D3]"
                                            : stopWarning
                                            ? "border-yellow-600 text-white hover:border-yellow-500"
                                            : "border-white/10 text-white hover:border-white/20"
                                    }`}
                                >
                                    {capturingHotkey === "stop" ? "Press keys..." : formatHotkey(stopRecordingHotkey)}
                                </button>
                                {stopWarning && (
                                    <p className="mt-1 text-xs text-yellow-500">{stopWarning}</p>
                                )}
                            </div>

                            {/* Manual Capture Hotkey */}
                            <div>
                                <label className="block text-sm font-medium text-white/80 mb-2">
                                    Manual Capture (Screenshot)
                                </label>
                                <button
                                    onClick={() => setCapturingHotkey("capture")}
                                    onKeyDown={(e) => capturingHotkey === "capture" && handleHotkeyCapture(e, "capture")}
                                    className={`w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border rounded-md text-left font-mono text-sm transition-colors ${
                                        capturingHotkey === "capture"
                                            ? "border-[#2721E8] text-[#49B8D3]"
                                            : captureWarning
                                            ? "border-yellow-600 text-white hover:border-yellow-500"
                                            : "border-white/10 text-white hover:border-white/20"
                                    }`}
                                >
                                    {capturingHotkey === "capture" ? "Press keys..." : formatHotkey(captureHotkey)}
                                </button>
                                {captureWarning && (
                                    <p className="mt-1 text-xs text-yellow-500">{captureWarning}</p>
                                )}
                            </div>
                            {hotkeysMatch && (
                                <p className="mt-2 text-xs text-red-500">
                                    Hotkeys cannot be the same
                                </p>
                            )}
                            <p className="mt-2 text-xs text-white/50">
                                Click on a field and press your desired key combination
                            </p>
                        </div>

                        {/* Save Button */}
                        <div className="pt-4">
                            <button
                                onClick={handleSave}
                                disabled={saving || (currentProvider?.requiresApiKey && !!apiKeyError) || hotkeysMatch}
                                className={`flex items-center gap-2 px-6 py-2 rounded-md font-medium transition-colors ${
                                    saved
                                        ? "bg-green-600 hover:bg-green-700"
                                        : "bg-[#2721E8] hover:bg-[#4a45f5]"
                                } ${saving || (currentProvider?.requiresApiKey && !!apiKeyError) || hotkeysMatch ? "opacity-50 cursor-not-allowed" : ""}`}
                            >
                                {saving ? <Spinner size="sm" /> : <Save size={16} />}
                                {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
