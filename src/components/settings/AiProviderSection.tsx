import { useEffect, useState } from "react";
import {
    Eye,
    EyeOff,
    ChevronDown,
    RefreshCw,
    Check,
    X,
    ExternalLink,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSettingsStore } from "../../store/settingsStore";
import Spinner from "../Spinner";
import Tooltip from "../Tooltip";
import { resolveModelPolicy } from "../../lib/aiPolicy";
import { PROVIDERS, getProvider, testConnection, fetchModels } from "../../lib/providers";

export default function AiProviderSection() {
    const {
        aiProvider,
        openaiBaseUrl,
        openaiApiKey,
        openaiModel,
        useProviderDefaults,
        temperatureOverride,
        outputTokenLimitOverride,
        contextWindowOverride,
        setAiProvider,
        setOpenaiBaseUrl,
        setOpenaiApiKey,
        setOpenaiModel,
        setUseProviderDefaults,
        setTemperatureOverride,
        setOutputTokenLimitOverride,
        setContextWindowOverride,
    } = useSettingsStore();

    const [showApiKey, setShowApiKey] = useState(false);
    const [apiKeyError, setApiKeyError] = useState<string | null>(null);
    const [providerDropdownOpen, setProviderDropdownOpen] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<{ testing: boolean; success?: boolean; message?: string }>({ testing: false });
    const [availableModels, setAvailableModels] = useState<string[]>([]);
    const [fetchingModels, setFetchingModels] = useState(false);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

    const currentProvider = getProvider(aiProvider);
    const resolvedStepPolicy = resolveModelPolicy({
        providerId: currentProvider?.id ?? "custom",
        model: openaiModel,
        purpose: "step-description",
        supportsVision: currentProvider?.supportsVision ?? true,
        settings: {
            useProviderDefaults,
            temperatureOverride,
            outputTokenLimitOverride,
            contextWindowOverride,
        },
    });
    const resolvedTitlePolicy = resolveModelPolicy({
        providerId: currentProvider?.id ?? "custom",
        model: openaiModel,
        purpose: "title",
        supportsVision: currentProvider?.supportsVision ?? true,
        settings: {
            useProviderDefaults,
            temperatureOverride,
            outputTokenLimitOverride,
            contextWindowOverride,
        },
    });

    const validateApiKey = (key: string): string | null => {
        if (!currentProvider?.requiresApiKey) return null;
        if (!key) return "API key is required for this provider";
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

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-white mb-1">AI Provider</h3>
                <p className="text-xs text-white/50">Connection details for the model that generates documentation, plus advanced policy overrides.</p>
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
                                    if (availableModels.length > 0) {
                                        setModelDropdownOpen(true);
                                    }
                                }}
                                onFocus={() => {
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
                                aria-label="Refresh models list"
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

            {/* API Key */}
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

            {/* Advanced AI (flattened) */}
            <div className="border-t border-white/8 pt-6">
                <div className="mb-4">
                    <h4 className="text-sm font-medium text-white/80">
                        Advanced
                    </h4>
                    <p className="text-xs text-white/50 mt-1">
                        Optional overrides for temperature, output limit, context window, and detected model policy.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div className="pr-4">
                            <label className="block text-sm font-medium text-white/80">
                                Use Provider Defaults
                            </label>
                            <p className="text-xs text-white/50 mt-1">
                                Recommended. Disable only if you need to override the app's conservative model policy.
                            </p>
                        </div>
                        <button
                            aria-label={`Use provider defaults: ${useProviderDefaults ? 'enabled' : 'disabled'}`}
                            onClick={() => setUseProviderDefaults(!useProviderDefaults)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                                useProviderDefaults ? 'bg-[#2721E8]' : 'bg-white/20'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    useProviderDefaults ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>

                    <div className={`grid gap-4 md:grid-cols-2 ${useProviderDefaults ? 'opacity-60' : ''}`}>
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">
                                Temperature Override
                            </label>
                            <input
                                type="number"
                                min="0"
                                max="2"
                                step="0.1"
                                value={temperatureOverride ?? ""}
                                disabled={useProviderDefaults}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setTemperatureOverride(value === "" ? null : parseFloat(value));
                                }}
                                placeholder="Auto"
                                className="w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border border-white/10 rounded-md text-white placeholder-white/40 focus:outline-none focus:border-[#2721E8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                            <p className="text-xs text-white/40 mt-1">
                                Leave empty to use the detected default or omit temperature for reasoning models.
                            </p>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">
                                Output Token Override
                            </label>
                            <input
                                type="number"
                                min="16"
                                max="8192"
                                step="1"
                                value={outputTokenLimitOverride ?? ""}
                                disabled={useProviderDefaults}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setOutputTokenLimitOverride(value === "" ? null : parseInt(value, 10));
                                }}
                                placeholder="Auto"
                                className="w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border border-white/10 rounded-md text-white placeholder-white/40 focus:outline-none focus:border-[#2721E8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                            <p className="text-xs text-white/40 mt-1">
                                Applies to chat completion output caps. Title generation uses its own smaller resolved cap.
                            </p>
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-white/60 mb-2">
                                Context Window Override
                            </label>
                            <input
                                type="number"
                                min="1024"
                                step="1024"
                                value={contextWindowOverride ?? ""}
                                disabled={useProviderDefaults}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setContextWindowOverride(value === "" ? null : parseInt(value, 10));
                                }}
                                placeholder="Auto"
                                className="w-full px-4 py-2 bg-[#161316]/70 backdrop-blur-sm border border-white/10 rounded-md text-white placeholder-white/40 focus:outline-none focus:border-[#2721E8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                            />
                            <p className="text-xs text-white/40 mt-1">
                                Mainly for unknown or custom models. The app still keeps a safety buffer and will trim old step context first.
                            </p>
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
                        <div>
                            <h5 className="text-sm font-medium text-white/80">Detected Policy</h5>
                            <p className="text-xs text-white/50 mt-1">
                                Effective policy for the current provider and model selection.
                            </p>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            <div className="rounded-lg bg-black/20 p-3">
                                <div className="text-xs uppercase tracking-wide text-white/40">Step Descriptions</div>
                                <div className="mt-2 text-sm text-white/80 space-y-1">
                                    <div>Context window: {resolvedStepPolicy.contextWindow.toLocaleString()} tokens</div>
                                    <div>Prompt budget: {resolvedStepPolicy.promptTokenBudget.toLocaleString()} tokens</div>
                                    <div>Output cap: {resolvedStepPolicy.maxOutputTokens.toLocaleString()} tokens</div>
                                    <div>Temperature: {resolvedStepPolicy.temperature === null ? "Omitted" : resolvedStepPolicy.temperature}</div>
                                    <div>Reasoning model: {resolvedStepPolicy.reasoningModel ? "Yes" : "No"}</div>
                                    <div>Vision support: {resolvedStepPolicy.supportsVision ? "Yes" : "No"}</div>
                                </div>
                            </div>

                            <div className="rounded-lg bg-black/20 p-3">
                                <div className="text-xs uppercase tracking-wide text-white/40">Titles</div>
                                <div className="mt-2 text-sm text-white/80 space-y-1">
                                    <div>Output cap: {resolvedTitlePolicy.maxOutputTokens.toLocaleString()} tokens</div>
                                    <div>Temperature: {resolvedTitlePolicy.temperature === null ? "Omitted" : resolvedTitlePolicy.temperature}</div>
                                    <div>Matched rule: {resolvedStepPolicy.matchedRuleId ?? "Provider fallback"}</div>
                                    <div>Image reserve: {resolvedStepPolicy.estimatedImageTokens.toLocaleString()} tokens</div>
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="text-xs uppercase tracking-wide text-white/40 mb-2">Notes</div>
                            <div className="space-y-1 text-xs text-white/55">
                                {resolvedStepPolicy.notes.map((note) => (
                                    <div key={note}>{note}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
