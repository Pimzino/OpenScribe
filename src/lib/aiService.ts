import { Step } from "../store/recorderStore";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../store/settingsStore";
import { getProvider } from "./providers";
import {
    buildChatCompletionBody,
    fitContextEntriesToBudget,
    formatPolicySummary,
    resolveModelPolicy,
    withPolicyDiagnostics,
} from "./aiPolicy";
import { buildSystemPrompt } from "./promptConstants";
import { normalizePathForMarkdown } from "./pathUtils";

// Sleep utility for delays
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Strip reasoning/thinking content from non-streaming responses
// Handles various formats: <think>...</think>, <thinking>...</thinking>, <reasoning>...</reasoning>
function stripReasoningContent(content: string): string {
    if (!content) return content;

    // First, try to find content AFTER the last closing thinking tag
    // This handles the common pattern: <think>reasoning...</think>actual answer
    const closingTagPatterns = [/<\/think>/gi, /<\/thinking>/gi, /<\/reasoning>/gi];

    for (const pattern of closingTagPatterns) {
        const matches = [...content.matchAll(pattern)];
        if (matches.length > 0) {
            // Get content after the last closing tag
            const lastMatch = matches[matches.length - 1];
            const afterTag = content.slice(lastMatch.index! + lastMatch[0].length).trim();
            if (afterTag) {
                return afterTag;
            }
        }
    }

    // If no closing tags found, remove all thinking/reasoning blocks using regex
    let result = content;

    // Remove <think>...</think> blocks
    result = result.replace(/<think>[\s\S]*?<\/think>/gi, '');

    // Remove <thinking>...</thinking> blocks
    result = result.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    // Remove <reasoning>...</reasoning> blocks
    result = result.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');

    // Also handle unclosed thinking tags (model only output thinking without closing)
    // Remove from opening tag to end if no closing tag
    result = result.replace(/<think>[\s\S]*$/gi, '');
    result = result.replace(/<thinking>[\s\S]*$/gi, '');
    result = result.replace(/<reasoning>[\s\S]*$/gi, '');

    // Clean up any extra whitespace left behind
    result = result.trim();

    // If result is empty but original had content, the model might have put
    // everything in thinking tags. In this case, return original as fallback.
    if (!result && content.trim()) {
        // Try to extract just text content, removing all XML-like tags
        const textOnly = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (textOnly) {
            console.warn('[AI Service] Reasoning filter resulted in empty content, using text extraction fallback');
            return textOnly;
        }
    }

    return result;
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

async function requestAiChatCompletion(
    openaiBaseUrl: string,
    openaiApiKey: string,
    body: Record<string, unknown>,
    config: RateLimitConfig
): Promise<string> {
    return invoke<string>("ai_chat_completion", {
        baseUrl: openaiBaseUrl,
        apiKey: openaiApiKey,
        body,
        retryConfig: {
            enableAutoRetry: config.enableAutoRetry,
            maxRetryAttempts: config.maxRetryAttempts,
            initialRetryDelayMs: config.initialRetryDelayMs,
        },
    });
}

function getAdvancedAiSettings() {
    const state = useSettingsStore.getState();
    return {
        useProviderDefaults: state.useProviderDefaults,
        temperatureOverride: state.temperatureOverride,
        outputTokenLimitOverride: state.outputTokenLimitOverride,
        contextWindowOverride: state.contextWindowOverride,
    };
}

function buildWorkflowContext(workflowTitle: string | undefined, contextEntries: string[]): string {
    let contextText = "";
    if (workflowTitle) {
        contextText += `\n\nWORKFLOW GOAL: "${workflowTitle}"\nThis is the overall objective. Each step should contribute to achieving this goal.`;
    }
    if (contextEntries.length > 0) {
        contextText += `\n\nPrevious steps in this workflow:\n${contextEntries.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}\n\nUse this context to understand what the user is trying to accomplish.`;
    }
    return contextText;
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
        return await invoke<string>("read_file_base64", { path: filePath });
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
    aiProviderId: string,
    openaiModel: string,
    sendScreenshots: boolean,
    workflowTitle?: string
): Promise<string> {
    // Get writing style options from settings
    const writingStyle = useSettingsStore.getState().writingStyle;
    const systemPrompt = buildSystemPrompt(sendScreenshots, writingStyle);

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

    const providerConfig = getProvider(aiProviderId);
    const policy = resolveModelPolicy({
        providerId: providerConfig?.id ?? "custom",
        model: openaiModel,
        purpose: "step-description",
        supportsVision: providerConfig?.supportsVision ?? true,
        settings: getAdvancedAiSettings(),
    });

    const buildPromptText = (contextEntries: string[]) => {
        const contextText = buildWorkflowContext(workflowTitle, contextEntries);
        return sendScreenshots
            ? `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}\n\nTASK: Write ONE clear instruction sentence for this step. Use the screenshot to identify UI elements accurately.`
            : `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}\n\nTASK: Write ONE clear instruction sentence for this step based on the metadata provided.`;
    };

    const contextBudget = fitContextEntriesToBudget({
        contextEntries: previousSteps,
        buildPromptText,
        fixedTextParts: [systemPrompt],
        includeImage: sendScreenshots && Boolean(screenshotBase64),
        policy,
    });
    const promptText = buildPromptText(contextBudget.retainedEntries);

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

    const rateLimitConfig = getRateLimitConfig();
    let rawContent: string;
    try {
        rawContent = await requestAiChatCompletion(
            openaiBaseUrl,
            openaiApiKey,
            buildChatCompletionBody(policy, openaiModel, [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
            ]),
            rateLimitConfig
        );
    } catch (error) {
        throw withPolicyDiagnostics(error, policy);
    }

    if (!rawContent) {
        return "Perform this action.";
    }

    if (contextBudget.droppedEntries > 0) {
        console.warn(
            `[AI Service] Trimmed ${contextBudget.droppedEntries} previous step(s) to fit model budget. ${formatPolicySummary(policy)}`
        );
    }

    // Strip any reasoning/thinking content from the response
    const stripped = stripReasoningContent(rawContent);
    return stripped || "Perform this action.";
}

// Generate a title for the documentation based on the workflow
// @ts-ignore - Reserved for future use
async function generateTitle(
    stepDescriptions: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    aiProviderId: string,
    openaiModel: string
): Promise<string> {
    const systemPrompt = `Based on the workflow steps provided, generate a short, descriptive title for a how-to guide.
Return ONLY the title text, nothing else. Keep it under 10 words.
Example: "How to Test Network Connectivity Using Ping"`;

    const providerConfig = getProvider(aiProviderId);
    const policy = resolveModelPolicy({
        providerId: providerConfig?.id ?? "custom",
        model: openaiModel,
        purpose: "title",
        supportsVision: providerConfig?.supportsVision ?? true,
        settings: getAdvancedAiSettings(),
    });

    const buildTitlePrompt = (entries: string[]) =>
        `Generate a title for this how-to guide based on these steps:\n\n${entries.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}`;

    const contextBudget = fitContextEntriesToBudget({
        contextEntries: stepDescriptions,
        buildPromptText: buildTitlePrompt,
        fixedTextParts: [systemPrompt],
        includeImage: false,
        policy,
    });

    const rateLimitConfig = getRateLimitConfig();
    try {
        const rawContent = await requestAiChatCompletion(
            openaiBaseUrl,
            openaiApiKey,
            buildChatCompletionBody(policy, openaiModel, [
                { role: "system", content: systemPrompt },
                { role: "user", content: buildTitlePrompt(contextBudget.retainedEntries) },
            ]),
            rateLimitConfig
        );
        if (contextBudget.droppedEntries > 0) {
            console.warn(
                `[AI Service] Trimmed ${contextBudget.droppedEntries} title context step(s) to fit model budget. ${formatPolicySummary(policy)}`
            );
        }
        return stripReasoningContent(rawContent) || "Step-by-Step Guide";
    } catch (error) {
        console.error(withPolicyDiagnostics(error, policy));
        return "Step-by-Step Guide";
    }
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
    const aiProviderId = storeState.aiProvider;
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
                aiProviderId,
                openaiModel,
                sendScreenshotsToAi,
                config?.workflowTitle
            );
            stepDescriptions.push(description);
        }
    } catch (error) {
        throw error;
    }

    // Use the workflow title (recording name) as the document title
    const title = config?.workflowTitle ?? 'Documentation';

    // Assemble the final document with screenshots
    let markdown = `# ${title}\n\n`;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const description = stepDescriptions[i];

        markdown += `## Step ${i + 1}\n\n`;
        markdown += `${description}\n\n`;

        if (step.screenshot) {
            const encodedPath = normalizePathForMarkdown(step.screenshot);
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

// Generate step description with streaming
async function generateStepDescriptionStreaming(
    step: Step & { ocr_text?: string },
    stepNumber: number,
    totalSteps: number,
    screenshotBase64: string | null,
    previousSteps: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    aiProviderId: string,
    openaiModel: string,
    sendScreenshots: boolean,
    onChunk: (text: string) => void,
    abortSignal?: AbortSignal,
    workflowTitle?: string
): Promise<string> {
    if (abortSignal?.aborted) {
        throw new DOMException('Generation cancelled', 'AbortError');
    }

    const description = await generateStepDescription(
        step,
        stepNumber,
        totalSteps,
        screenshotBase64,
        previousSteps,
        openaiBaseUrl,
        openaiApiKey,
        aiProviderId,
        openaiModel,
        sendScreenshots,
        workflowTitle
    );

    if (abortSignal?.aborted) {
        throw new DOMException('Generation cancelled', 'AbortError');
    }

    onChunk(description);
    return description;
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
            const encodedPath = normalizePathForMarkdown(step.screenshot);
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
    const aiProviderId = storeState.aiProvider;
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
                    aiProviderId,
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
        throw error;
    }

    // Use the workflow title (recording name) as the document title
    const title = config?.workflowTitle ?? 'Documentation';
    callbacks.onTitleGenerated?.(title);

    // Build final markdown with title
    const finalMarkdown = buildPartialMarkdown(steps, stepDescriptions, steps.length, title);
    callbacks.onDocumentUpdate?.(finalMarkdown);
    callbacks.onComplete?.(finalMarkdown);

    return finalMarkdown;
}
