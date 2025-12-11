import { Step } from "../store/recorderStore";
import { readFile } from "@tauri-apps/plugin-fs";
import { useSettingsStore } from "../store/settingsStore";
import { getProvider } from "./providers";
import { buildSystemPrompt } from "./promptConstants";

// Default timeout for AI requests (in milliseconds)
const DEFAULT_TIMEOUT = 120000; // 2 minutes for local models which can be slow

// Sleep utility for delays
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Rate limit mitigation configuration
interface RateLimitConfig {
    enableAutoRetry: boolean;
    maxRetryAttempts: number;
    initialRetryDelayMs: number;
    enableRequestThrottling: boolean;
    throttleDelayMs: number;
}

function getRateLimitConfig(): RateLimitConfig {
    const state = useSettingsStore.getState();
    return {
        enableAutoRetry: state.enableAutoRetry ?? true,
        maxRetryAttempts: state.maxRetryAttempts ?? 3,
        initialRetryDelayMs: state.initialRetryDelayMs ?? 1000,
        enableRequestThrottling: state.enableRequestThrottling ?? false,
        throttleDelayMs: state.throttleDelayMs ?? 500,
    };
}

// Execute fetch with retry logic for rate limits
async function fetchWithRetry(
    url: string,
    options: RequestInit,
    config: RateLimitConfig
): Promise<Response> {
    let lastError: Error | null = null;
    let attempt = 0;
    const maxAttempts = config.enableAutoRetry ? config.maxRetryAttempts : 0;

    while (attempt <= maxAttempts) {
        try {
            const response = await fetch(url, options);

            // If rate limited and retries enabled, wait and retry
            if (response.status === 429 && config.enableAutoRetry && attempt < maxAttempts) {
                // Try to get retry-after header
                const retryAfter = response.headers.get('Retry-After');
                let delayMs: number;

                if (retryAfter) {
                    // Retry-After can be seconds or a date
                    const retrySeconds = parseInt(retryAfter, 10);
                    if (!isNaN(retrySeconds)) {
                        delayMs = retrySeconds * 1000;
                    } else {
                        // Parse as date
                        const retryDate = new Date(retryAfter);
                        delayMs = Math.max(0, retryDate.getTime() - Date.now());
                    }
                } else {
                    // Exponential backoff: initialDelay * 2^attempt
                    delayMs = config.initialRetryDelayMs * Math.pow(2, attempt);
                }

                // Cap maximum delay at 60 seconds
                delayMs = Math.min(delayMs, 60000);

                console.log(`Rate limited (429). Retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms`);
                await sleep(delayMs);
                attempt++;
                continue;
            }

            return response;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Don't retry on timeout or abort errors
            if (error instanceof DOMException && error.name === 'AbortError') {
                throw error;
            }

            // For network errors, retry if configured
            if (config.enableAutoRetry && attempt < maxAttempts) {
                const delayMs = config.initialRetryDelayMs * Math.pow(2, attempt);
                console.log(`Network error. Retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms`);
                await sleep(delayMs);
                attempt++;
                continue;
            }

            throw error;
        }
    }

    // Should only reach here if we exhausted retries on a 429
    throw lastError || new Error('Request failed after retries');
}

// Crop image around a point (for click steps)
async function cropAroundPoint(
    base64Image: string,
    x: number,
    y: number,
    radius: number = 300
): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) {
                resolve(base64Image); // Fallback to original
                return;
            }

            // Calculate crop region
            const startX = Math.max(0, x - radius);
            const startY = Math.max(0, y - radius);
            const endX = Math.min(img.width, x + radius);
            const endY = Math.min(img.height, y + radius);
            const width = endX - startX;
            const height = endY - startY;

            canvas.width = width;
            canvas.height = height;

            // Draw cropped region
            ctx.drawImage(
                img,
                startX, startY, width, height,
                0, 0, width, height
            );

            // Return as base64 (without data URL prefix)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            resolve(dataUrl.replace(/^data:image\/\w+;base64,/, ''));
        };
        img.onerror = () => resolve(base64Image); // Fallback to original
        img.src = `data:image/jpeg;base64,${base64Image}`;
    });
}

// Helper to convert file to base64 for AI APIs
async function fileToBase64(filePath: string): Promise<string> {
    try {
        const data = await readFile(filePath);
        const bytes = new Uint8Array(data);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    } catch (error) {
        console.error("Failed to read file:", filePath, error);
        return "";
    }
}

// Generate description for a single step
async function generateStepDescription(
    step: Step & { ocr_text?: string },
    stepNumber: number,
    totalSteps: number,
    screenshotBase64: string | null,
    previousSteps: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    openaiModel: string,
    sendScreenshots: boolean,
    workflowTitle?: string
): Promise<string> {
    // Get custom guidelines from settings (empty = use default)
    const styleGuidelines = useSettingsStore.getState().styleGuidelines;
    const systemPrompt = buildSystemPrompt(sendScreenshots, styleGuidelines);

    let actionDescription: string;
    if (step.type_ === 'click') {
        // Build structured description with element info
        const parts: string[] = [`ACTION: CLICK`];
        if (step.element_name) parts.push(`Target Element: "${step.element_name}"`);
        if (step.element_type) parts.push(`Element Type: ${step.element_type}`);
        if (step.app_name) parts.push(`Application: ${step.app_name}`);

        // Add OCR text if available and not sending screenshots
        if (step.ocr_text && !sendScreenshots) {
            const truncatedOcr = step.ocr_text.length > 200
                ? step.ocr_text.substring(0, 200) + '...'
                : step.ocr_text;
            parts.push(`Nearby visible text: "${truncatedOcr}"`);
        }

        parts.push(`Click location: (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})`);
        parts.push(`Write an instruction telling the user to click this element.`);
        actionDescription = parts.join('\n');
    } else if (step.type_ === 'type') {
        actionDescription = `ACTION: TYPE
Typed text: "${step.text}"
NOTE: The typed text may be partial (for autocomplete) or abbreviated. If user context provides more specific information (like a full URL, file path, or complete value), use that instead of the literal typed text.
Write an instruction that achieves the user's intent.`;
        // Add OCR context if available and not sending screenshots
        if (step.ocr_text && !sendScreenshots) {
            const truncatedOcr = step.ocr_text.length > 100
                ? step.ocr_text.substring(0, 100) + '...'
                : step.ocr_text;
            actionDescription += `\nContext (OCR): "${truncatedOcr}"`;
        }
    } else {
        // capture type
        actionDescription = `ACTION: CAPTURE (Verification Step)
This is an observation/verification step. The user captured the screen to document a result.
Write a VERIFICATION instruction (e.g., "Verify that..." or "Observe the...")`;
        // Add OCR text if available and not sending screenshots
        if (step.ocr_text && !sendScreenshots) {
            const truncatedOcr = step.ocr_text.length > 300
                ? step.ocr_text.substring(0, 300) + '...'
                : step.ocr_text;
            actionDescription += `\nVisible content (OCR): "${truncatedOcr}"`;
        }
    }

    // Add user description if provided - emphasize it as critical intent context
    if (step.description) {
        actionDescription += `\n\nIMPORTANT USER CONTEXT: "${step.description}"
This description reveals the user's INTENT. Incorporate this information into your instruction - don't just describe the literal action.`;
    }

    // Build context from workflow title and previous steps
    let contextText = "";
    if (workflowTitle) {
        contextText += `\n\nWORKFLOW GOAL: "${workflowTitle}"\nThis is the overall objective. Each step should contribute to achieving this goal.`;
    }
    if (previousSteps.length > 0) {
        contextText += `\n\nPrevious steps in this workflow:\n${previousSteps.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}\n\nUse this context to understand what the user is trying to accomplish.`;
    }

    const promptText = sendScreenshots
        ? `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}\n\nTASK: Write ONE clear instruction sentence for this step. Use the screenshot to identify UI elements accurately.`
        : `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}\n\nTASK: Write ONE clear instruction sentence for this step based on the metadata provided.`;

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
            type: "text",
            text: promptText
        }
    ];

    // Only include image if sendScreenshots is enabled and we have an image
    if (sendScreenshots && screenshotBase64) {
        userContent.push({
            type: "image_url",
            image_url: {
                url: `data:image/jpeg;base64,${screenshotBase64}`
            }
        });
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    // Only add Authorization header if API key is provided
    if (openaiApiKey) {
        headers["Authorization"] = `Bearer ${openaiApiKey}`;
    }

    const rateLimitConfig = getRateLimitConfig();
    const response = await fetchWithRetry(
        `${openaiBaseUrl}/chat/completions`,
        {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: openaiModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                max_tokens: 256,
                temperature: 0.3,
            }),
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        },
        rateLimitConfig
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        // Provide user-friendly error messages
        if (response.status === 401) {
            throw new Error("Authentication failed. Please check your API key in Settings.");
        }
        if (response.status === 404) {
            throw new Error(`Model "${openaiModel}" not found. Please verify the model name in Settings.`);
        }
        if (response.status === 429) {
            // If we get here, retries were exhausted or disabled
            throw new Error("Rate limit exceeded after all retries. Try increasing retry settings or wait before trying again.");
        }
        if (response.status >= 500) {
            throw new Error("The AI server is experiencing issues. Please try again later.");
        }

        throw new Error(
            `AI request failed: ${response.status} ${response.statusText}${
                errorData.error?.message ? ` - ${errorData.error.message}` : ""
            }`
        );
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "Perform this action.";
}

// Generate a title for the documentation based on the workflow
async function generateTitle(
    stepDescriptions: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    openaiModel: string
): Promise<string> {
    const systemPrompt = `Based on the workflow steps provided, generate a short, descriptive title for a how-to guide.
Return ONLY the title text, nothing else. Keep it under 10 words.
Example: "How to Test Network Connectivity Using Ping"`;

    const stepsText = stepDescriptions.map((desc, i) => `${i + 1}. ${desc}`).join('\n');

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    // Only add Authorization header if API key is provided
    if (openaiApiKey) {
        headers["Authorization"] = `Bearer ${openaiApiKey}`;
    }

    const rateLimitConfig = getRateLimitConfig();
    const response = await fetchWithRetry(
        `${openaiBaseUrl}/chat/completions`,
        {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: openaiModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: `Generate a title for this how-to guide based on these steps:\n\n${stepsText}` }
                ],
                max_tokens: 64,
                temperature: 0.3,
            }),
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        },
        rateLimitConfig
    );

    if (!response.ok) {
        return "Step-by-Step Guide";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "Step-by-Step Guide";
}

interface AIConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    workflowTitle?: string;
}

interface StepLike {
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
    description?: string;
    is_cropped?: boolean;
    ocr_text?: string;
    ocr_status?: string;
}

export async function generateDocumentation(steps: StepLike[], config?: AIConfig): Promise<string> {
    // Use provided config or fall back to store
    const storeState = useSettingsStore.getState();
    const openaiApiKey = config?.apiKey ?? storeState.openaiApiKey;
    const openaiBaseUrl = config?.baseUrl || storeState.openaiBaseUrl;
    const openaiModel = config?.model || storeState.openaiModel;
    const sendScreenshotsToAi = storeState.sendScreenshotsToAi;

    // Get provider configuration to check if API key is required
    const providerConfig = getProvider(storeState.aiProvider);
    const requiresApiKey = providerConfig?.requiresApiKey ?? true;

    if (requiresApiKey && !openaiApiKey) {
        throw new Error("API key not configured. Please go to Settings to add your API key.");
    }

    if (!openaiBaseUrl) {
        throw new Error("Base URL not configured. Please go to Settings to configure the AI provider.");
    }

    if (!openaiModel) {
        throw new Error("Model not specified. Please go to Settings to select a model.");
    }

    if (steps.length === 0) {
        throw new Error("No steps to generate documentation from.");
    }

    // Test connection first by checking if server is reachable
    try {
        const testResponse = await fetch(`${openaiBaseUrl}/models`, {
            method: 'GET',
            headers: openaiApiKey ? { 'Authorization': `Bearer ${openaiApiKey}` } : {},
            signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        // If /models fails, that's okay - some providers don't support it
        // But if we get a connection refused error, throw a helpful message
        if (!testResponse && !openaiBaseUrl.includes('api.openai.com')) {
            // Check if it's a local server that might not be running
            const isLocalServer = openaiBaseUrl.includes('localhost') || openaiBaseUrl.includes('127.0.0.1');
            if (isLocalServer) {
                throw new Error(
                    `Cannot connect to ${openaiBaseUrl}. Make sure your local AI server is running.`
                );
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('Cannot connect')) {
            throw error;
        }
        // Other errors during test are okay, we'll try the actual request
    }



    // Convert all screenshots to base64 first (only if sending screenshots)
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step) => ({
            step,
            screenshotBase64: sendScreenshotsToAi && step.screenshot
                ? await fileToBase64(step.screenshot)
                : null
        }))
    );

    // Generate description for each step with context from previous steps
    const stepDescriptions: string[] = [];
    const rateLimitConfig = getRateLimitConfig();
    try {
        for (let i = 0; i < stepsWithBase64.length; i++) {
            const { step, screenshotBase64 } = stepsWithBase64[i];

            // Apply throttling delay between requests (not before the first one)
            if (i > 0 && rateLimitConfig.enableRequestThrottling && rateLimitConfig.throttleDelayMs > 0) {
                await sleep(rateLimitConfig.throttleDelayMs);
            }

            // For click steps that haven't been manually cropped, crop image around the click point
            // For manually cropped steps, capture steps, and type steps, use the image as-is
            let imageToSend = screenshotBase64;
            if (sendScreenshotsToAi && step.type_ === 'click' && step.x && step.y && screenshotBase64 && !step.is_cropped) {
                imageToSend = await cropAroundPoint(screenshotBase64, step.x, step.y, 300);
            }
            // For capture steps and manually cropped steps, use full/cropped image as-is

            const description = await generateStepDescription(
                step,
                i + 1,
                steps.length,
                imageToSend,
                stepDescriptions.slice(), // Pass previous step descriptions as context
                openaiBaseUrl,
                openaiApiKey,
                openaiModel,
                sendScreenshotsToAi,
                config?.workflowTitle
            );
            stepDescriptions.push(description);
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new Error(
                "Request timed out. This can happen with slow connections or when using local models. " +
                "Try using a faster model or check your server's performance."
            );
        }
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new Error(
                `Connection failed to ${openaiBaseUrl}. Please check that the server is running and accessible.`
            );
        }
        throw error;
    }

    // Generate title based on all step descriptions (better context)
    const title = await generateTitle(stepDescriptions, openaiBaseUrl, openaiApiKey, openaiModel);

    // Assemble the final document with screenshots
    let markdown = `# ${title}\n\n`;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const description = stepDescriptions[i];

        markdown += `## Step ${i + 1}\n\n`;
        markdown += `${description}\n\n`;

        if (step.screenshot) {
            // Use file path for local display - normalize path and encode for markdown compatibility
            const normalizedPath = step.screenshot.replace(/\\/g, '/');
            // Encode spaces and special characters for markdown URL compatibility
            const encodedPath = normalizedPath.replace(/ /g, '%20');
            markdown += `![Step ${i + 1} Screenshot](${encodedPath})\n\n`;
        }
    }

    return markdown;
}

// Streaming callbacks interface for real-time updates
export interface StreamingCallbacks {
    onStepStart?: (stepIndex: number, totalSteps: number) => void;
    onTextChunk?: (stepIndex: number, text: string) => void;
    onStepComplete?: (stepIndex: number, fullDescription: string) => void;
    onDocumentUpdate?: (markdown: string) => void;
    onTitleGenerated?: (title: string) => void;
    onError?: (stepIndex: number, error: Error) => void;
    onComplete?: (finalMarkdown: string) => void;
}

// Parse SSE stream and yield text chunks
async function* parseSSEStream(
    response: Response,
    abortSignal?: AbortSignal
): AsyncGenerator<string, string, unknown> {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Response body is not readable');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

    try {
        while (true) {
            if (abortSignal?.aborted) {
                reader.cancel();
                throw new DOMException('Generation cancelled', 'AbortError');
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmedLine = line.trim();
                if (trimmedLine.startsWith('data: ')) {
                    const data = trimmedLine.slice(6);
                    if (data === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content || '';
                        if (delta) {
                            fullContent += delta;
                            yield delta;
                        }
                    } catch {
                        // Skip malformed JSON chunks
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return fullContent.trim() || "Perform this action.";
}

// Generate step description with streaming
async function generateStepDescriptionStreaming(
    step: Step & { ocr_text?: string },
    stepNumber: number,
    totalSteps: number,
    screenshotBase64: string | null,
    previousSteps: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    openaiModel: string,
    sendScreenshots: boolean,
    onChunk: (text: string) => void,
    abortSignal?: AbortSignal,
    workflowTitle?: string
): Promise<string> {
    const styleGuidelines = useSettingsStore.getState().styleGuidelines;
    const systemPrompt = buildSystemPrompt(sendScreenshots, styleGuidelines);

    let actionDescription: string;
    if (step.type_ === 'click') {
        const parts: string[] = [`ACTION: CLICK`];
        if (step.element_name) parts.push(`Target Element: "${step.element_name}"`);
        if (step.element_type) parts.push(`Element Type: ${step.element_type}`);
        if (step.app_name) parts.push(`Application: ${step.app_name}`);

        if (step.ocr_text && !sendScreenshots) {
            const truncatedOcr = step.ocr_text.length > 200
                ? step.ocr_text.substring(0, 200) + '...'
                : step.ocr_text;
            parts.push(`Nearby visible text: "${truncatedOcr}"`);
        }

        parts.push(`Click location: (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})`);
        parts.push(`Write an instruction telling the user to click this element.`);
        actionDescription = parts.join('\n');
    } else if (step.type_ === 'type') {
        actionDescription = `ACTION: TYPE
Typed text: "${step.text}"
NOTE: The typed text may be partial (for autocomplete) or abbreviated. If user context provides more specific information (like a full URL, file path, or complete value), use that instead of the literal typed text.
Write an instruction that achieves the user's intent.`;
        if (step.ocr_text && !sendScreenshots) {
            const truncatedOcr = step.ocr_text.length > 100
                ? step.ocr_text.substring(0, 100) + '...'
                : step.ocr_text;
            actionDescription += `\nContext (OCR): "${truncatedOcr}"`;
        }
    } else {
        actionDescription = `ACTION: CAPTURE (Verification Step)
This is an observation/verification step. The user captured the screen to document a result.
Write a VERIFICATION instruction (e.g., "Verify that..." or "Observe the...")`;
        if (step.ocr_text && !sendScreenshots) {
            const truncatedOcr = step.ocr_text.length > 300
                ? step.ocr_text.substring(0, 300) + '...'
                : step.ocr_text;
            actionDescription += `\nVisible content (OCR): "${truncatedOcr}"`;
        }
    }

    if (step.description) {
        actionDescription += `\n\nIMPORTANT USER CONTEXT: "${step.description}"
This description reveals the user's INTENT. Incorporate this information into your instruction - don't just describe the literal action.`;
    }

    // Build context from workflow title and previous steps
    let contextText = "";
    if (workflowTitle) {
        contextText += `\n\nWORKFLOW GOAL: "${workflowTitle}"\nThis is the overall objective. Each step should contribute to achieving this goal.`;
    }
    if (previousSteps.length > 0) {
        contextText += `\n\nPrevious steps in this workflow:\n${previousSteps.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}\n\nUse this context to understand what the user is trying to accomplish.`;
    }

    const promptText = sendScreenshots
        ? `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}\n\nTASK: Write ONE clear instruction sentence for this step. Use the screenshot to identify UI elements accurately.`
        : `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}\n\nTASK: Write ONE clear instruction sentence for this step based on the metadata provided.`;

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: promptText }
    ];

    if (sendScreenshots && screenshotBase64) {
        userContent.push({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` }
        });
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (openaiApiKey) {
        headers["Authorization"] = `Bearer ${openaiApiKey}`;
    }

    const rateLimitConfig = getRateLimitConfig();
    const response = await fetchWithRetry(
        `${openaiBaseUrl}/chat/completions`,
        {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: openaiModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                max_tokens: 256,
                temperature: 0.3,
                stream: true,
            }),
            signal: abortSignal || AbortSignal.timeout(DEFAULT_TIMEOUT),
        },
        rateLimitConfig
    );

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));

        if (response.status === 401) {
            throw new Error("Authentication failed. Please check your API key in Settings.");
        }
        if (response.status === 404) {
            throw new Error(`Model "${openaiModel}" not found. Please verify the model name in Settings.`);
        }
        if (response.status === 429) {
            throw new Error("Rate limit exceeded after all retries. Try increasing retry settings or wait before trying again.");
        }
        if (response.status >= 500) {
            throw new Error("The AI server is experiencing issues. Please try again later.");
        }

        throw new Error(
            `AI request failed: ${response.status} ${response.statusText}${
                errorData.error?.message ? ` - ${errorData.error.message}` : ""
            }`
        );
    }

    // Parse streaming response
    let fullContent = '';
    const generator = parseSSEStream(response, abortSignal);

    for await (const chunk of generator) {
        fullContent += chunk;
        onChunk(chunk);
    }

    return fullContent.trim() || "Perform this action.";
}

// Build partial markdown document from completed steps
function buildPartialMarkdown(
    steps: StepLike[],
    stepDescriptions: string[],
    completedCount: number,
    title?: string
): string {
    let markdown = title ? `# ${title}\n\n` : '# Generating Documentation...\n\n';

    for (let i = 0; i < completedCount; i++) {
        const step = steps[i];
        const description = stepDescriptions[i];

        markdown += `## Step ${i + 1}\n\n`;
        markdown += `${description}\n\n`;

        if (step.screenshot) {
            const normalizedPath = step.screenshot.replace(/\\/g, '/');
            const encodedPath = normalizedPath.replace(/ /g, '%20');
            markdown += `![Step ${i + 1} Screenshot](${encodedPath})\n\n`;
        }
    }

    return markdown;
}

// Main streaming documentation generation function
export async function generateDocumentationStreaming(
    steps: StepLike[],
    config: AIConfig | undefined,
    callbacks: StreamingCallbacks,
    abortSignal?: AbortSignal
): Promise<string> {
    const storeState = useSettingsStore.getState();
    const openaiApiKey = config?.apiKey ?? storeState.openaiApiKey;
    const openaiBaseUrl = config?.baseUrl || storeState.openaiBaseUrl;
    const openaiModel = config?.model || storeState.openaiModel;
    const sendScreenshotsToAi = storeState.sendScreenshotsToAi;

    const providerConfig = getProvider(storeState.aiProvider);
    const requiresApiKey = providerConfig?.requiresApiKey ?? true;

    if (requiresApiKey && !openaiApiKey) {
        throw new Error("API key not configured. Please go to Settings to add your API key.");
    }

    if (!openaiBaseUrl) {
        throw new Error("Base URL not configured. Please go to Settings to configure the AI provider.");
    }

    if (!openaiModel) {
        throw new Error("Model not specified. Please go to Settings to select a model.");
    }

    if (steps.length === 0) {
        throw new Error("No steps to generate documentation from.");
    }

    // Test connection (same as non-streaming version)
    try {
        const testResponse = await fetch(`${openaiBaseUrl}/models`, {
            method: 'GET',
            headers: openaiApiKey ? { 'Authorization': `Bearer ${openaiApiKey}` } : {},
            signal: AbortSignal.timeout(10000),
        }).catch(() => null);

        if (!testResponse && !openaiBaseUrl.includes('api.openai.com')) {
            const isLocalServer = openaiBaseUrl.includes('localhost') || openaiBaseUrl.includes('127.0.0.1');
            if (isLocalServer) {
                throw new Error(
                    `Cannot connect to ${openaiBaseUrl}. Make sure your local AI server is running.`
                );
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message.includes('Cannot connect')) {
            throw error;
        }
    }

    // Convert all screenshots to base64 first
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step) => ({
            step,
            screenshotBase64: sendScreenshotsToAi && step.screenshot
                ? await fileToBase64(step.screenshot)
                : null
        }))
    );

    const stepDescriptions: string[] = [];
    const rateLimitConfig = getRateLimitConfig();

    try {
        for (let i = 0; i < stepsWithBase64.length; i++) {
            if (abortSignal?.aborted) {
                throw new DOMException('Generation cancelled', 'AbortError');
            }

            callbacks.onStepStart?.(i, steps.length);

            const { step, screenshotBase64 } = stepsWithBase64[i];

            // Apply throttling delay between requests
            if (i > 0 && rateLimitConfig.enableRequestThrottling && rateLimitConfig.throttleDelayMs > 0) {
                await sleep(rateLimitConfig.throttleDelayMs);
            }

            // Crop image for click steps if needed
            let imageToSend = screenshotBase64;
            if (sendScreenshotsToAi && step.type_ === 'click' && step.x && step.y && screenshotBase64 && !step.is_cropped) {
                imageToSend = await cropAroundPoint(screenshotBase64, step.x, step.y, 300);
            }

            try {
                const description = await generateStepDescriptionStreaming(
                    step,
                    i + 1,
                    steps.length,
                    imageToSend,
                    stepDescriptions.slice(),
                    openaiBaseUrl,
                    openaiApiKey,
                    openaiModel,
                    sendScreenshotsToAi,
                    (chunk) => callbacks.onTextChunk?.(i, chunk),
                    abortSignal,
                    config?.workflowTitle
                );

                stepDescriptions.push(description);
                callbacks.onStepComplete?.(i, description);

                // Update accumulated document
                const partialMarkdown = buildPartialMarkdown(steps, stepDescriptions, i + 1);
                callbacks.onDocumentUpdate?.(partialMarkdown);

            } catch (error) {
                callbacks.onError?.(i, error as Error);
                throw error;
            }
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw error;
        }
        if (error instanceof TypeError && error.message.includes('fetch')) {
            throw new Error(
                `Connection failed to ${openaiBaseUrl}. Please check that the server is running and accessible.`
            );
        }
        throw error;
    }

    // Generate title
    const title = await generateTitle(stepDescriptions, openaiBaseUrl, openaiApiKey, openaiModel);
    callbacks.onTitleGenerated?.(title);

    // Build final markdown with title
    const finalMarkdown = buildPartialMarkdown(steps, stepDescriptions, steps.length, title);
    callbacks.onDocumentUpdate?.(finalMarkdown);
    callbacks.onComplete?.(finalMarkdown);

    return finalMarkdown;
}
