import { invoke } from "@tauri-apps/api/core";
import { log, describeError } from "./logger";

export type AIProviderId =
    | "openai"
    | "ollama"
    | "lmstudio"
    | "anthropic"
    | "openrouter"
    | "chutes"
    | "custom";

export interface AIProvider {
    id: AIProviderId;
    name: string;
    defaultBaseUrl: string;
    requiresApiKey: boolean;
    supportsVision: boolean;
    defaultModel?: string;
    helpText?: string;
    helpUrl?: string;
}

export const PROVIDERS: AIProvider[] = [
    {
        id: 'openai',
        name: 'OpenAI',
        defaultBaseUrl: 'https://api.openai.com/v1',
        requiresApiKey: true,
        supportsVision: true,
        defaultModel: 'gpt-4o',
        helpText: 'Get your API key from platform.openai.com',
        helpUrl: 'https://platform.openai.com/api-keys',
    },
    {
        id: 'ollama',
        name: 'Ollama',
        defaultBaseUrl: 'http://localhost:11434/v1',
        requiresApiKey: false,
        supportsVision: true,
        defaultModel: 'llava',
        helpText: 'Make sure Ollama is running. Use a vision model like llava or bakllava.',
        helpUrl: 'https://ollama.com/',
    },
    {
        id: 'lmstudio',
        name: 'LM Studio',
        defaultBaseUrl: 'http://localhost:1234/v1',
        requiresApiKey: false,
        supportsVision: true,
        helpText: 'Start the local server in LM Studio and load a vision-capable model.',
        helpUrl: 'https://lmstudio.ai/',
    },
    {
        id: 'anthropic',
        name: 'Anthropic',
        defaultBaseUrl: 'https://api.anthropic.com/v1',
        requiresApiKey: true,
        supportsVision: true,
        defaultModel: 'claude-sonnet-4-20250514',
        helpText: 'Get your API key from console.anthropic.com',
        helpUrl: 'https://console.anthropic.com/',
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        defaultBaseUrl: 'https://openrouter.ai/api/v1',
        requiresApiKey: true,
        supportsVision: true,
        defaultModel: 'openai/gpt-4o',
        helpText: 'Access multiple AI providers through one API.',
        helpUrl: 'https://openrouter.ai/',
    },
    {
        id: 'chutes',
        name: 'Chutes AI',
        defaultBaseUrl: 'https://llm.chutes.ai/v1',
        requiresApiKey: true,
        supportsVision: true,
        defaultModel: 'meta-llama/Llama-3.2-11B-Vision-Instruct',
        helpText: 'Get your API key from chutes.ai. Access many open-source models with predictable pricing.',
        helpUrl: 'https://chutes.ai/',
    },
    {
        id: 'custom',
        name: 'Custom (OpenAI-compatible)',
        defaultBaseUrl: '',
        requiresApiKey: true,
        supportsVision: true,
        helpText: 'Use any OpenAI-compatible API endpoint.',
    },
];

export function getProvider(id: string): AIProvider | undefined {
    return PROVIDERS.find(p => p.id === id);
}

export function getDefaultProvider(): AIProvider {
    return PROVIDERS[0]; // OpenAI
}

interface TestConnectionResult {
    success: boolean;
    message: string;
    models?: string[];
}

// Test connection to the AI provider
export async function testConnection(
    baseUrl: string,
    apiKey: string,
    requiresApiKey: boolean
): Promise<TestConnectionResult> {
    log.ai.info("Testing AI provider connection", { baseUrl, requiresApiKey });
    try {
        const result = await invoke<TestConnectionResult>("ai_test_connection", {
            baseUrl,
            apiKey,
            requiresApiKey,
        });
        if (result.success) {
            log.ai.info("Provider connection succeeded", {
                baseUrl,
                modelCount: result.models?.length ?? 0,
            });
        } else {
            log.ai.warn("Provider connection reported failure", {
                baseUrl,
                providerMessage: result.message,
            });
        }
        return result;
    } catch (error) {
        const described = describeError(error);
        log.ai.error("Provider connection threw", {
            baseUrl,
            ...described.metadata,
        });
        return {
            success: false,
            message: `Connection failed: ${described.message || 'Unknown error'}`,
        };
    }
}

// Fetch available models from provider
export async function fetchModels(
    baseUrl: string,
    apiKey: string,
    requiresApiKey: boolean
): Promise<string[]> {
    log.ai.info("Fetching models from provider", { baseUrl, requiresApiKey });
    try {
        const models = await invoke<string[]>("ai_fetch_models", {
            baseUrl,
            apiKey,
            requiresApiKey,
        });
        log.ai.info("Fetched models", { baseUrl, count: models.length });
        return models;
    } catch (error) {
        log.ai.error("Failed to fetch models", {
            baseUrl,
            ...describeError(error).metadata,
        });
        return [];
    }
}
