export interface AIProvider {
    id: string;
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

// Test connection to the AI provider
export async function testConnection(
    baseUrl: string,
    apiKey: string,
    requiresApiKey: boolean
): Promise<{ success: boolean; message: string; models?: string[] }> {
    try {
        // Try to fetch models list
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        
        if (apiKey && requiresApiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) {
            if (response.status === 401) {
                return { success: false, message: 'Authentication failed. Check your API key.' };
            }
            if (response.status === 404) {
                // Some providers don't have /models endpoint, try a simple completion
                return await testWithCompletion(baseUrl, apiKey, requiresApiKey);
            }
            return { success: false, message: `Server returned ${response.status}: ${response.statusText}` };
        }

        const data = await response.json();
        const models = data.data?.map((m: { id: string }) => m.id) || [];
        
        return {
            success: true,
            message: `Connected successfully. ${models.length} model${models.length !== 1 ? 's' : ''} available.`,
            models,
        };
    } catch (error) {
        if (error instanceof TypeError && error.message.includes('fetch')) {
            return {
                success: false,
                message: 'Connection refused. Make sure the server is running.',
            };
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
            return {
                success: false,
                message: 'Connection timed out. Check the server URL.',
            };
        }
        return {
            success: false,
            message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

// Fallback test using a minimal completion request
async function testWithCompletion(
    baseUrl: string,
    apiKey: string,
    requiresApiKey: boolean
): Promise<{ success: boolean; message: string }> {
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        
        if (apiKey && requiresApiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: 'gpt-4o', // This will be ignored by local models
                messages: [{ role: 'user', content: 'Hi' }],
                max_tokens: 1,
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (response.ok) {
            return { success: true, message: 'Connected successfully.' };
        }
        
        if (response.status === 401) {
            return { success: false, message: 'Authentication failed. Check your API key.' };
        }
        
        return { success: false, message: `Server returned ${response.status}: ${response.statusText}` };
    } catch (error) {
        if (error instanceof TypeError && error.message.includes('fetch')) {
            return {
                success: false,
                message: 'Connection refused. Make sure the server is running.',
            };
        }
        return {
            success: false,
            message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
    }
}

// Fetch available models from provider
export async function fetchModels(
    baseUrl: string,
    apiKey: string,
    requiresApiKey: boolean
): Promise<string[]> {
    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };
        
        if (apiKey && requiresApiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(`${baseUrl}/models`, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        return data.data?.map((m: { id: string }) => m.id) || [];
    } catch {
        return [];
    }
}
