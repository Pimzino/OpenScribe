import { Step } from "../store/recorderStore";
import { readFile } from "@tauri-apps/plugin-fs";
import { useSettingsStore } from "../store/settingsStore";
import { getProvider } from "./providers";

// Default timeout for AI requests (in milliseconds)
const DEFAULT_TIMEOUT = 120000; // 2 minutes for local models which can be slow

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
    step: Step,
    stepNumber: number,
    totalSteps: number,
    screenshotBase64: string,
    previousSteps: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    openaiModel: string
): Promise<string> {
    const systemPrompt = `You are a technical documentation writer creating step-by-step guides.

For CLICK actions:
- Element info (name, type, app) may be provided - use this as the primary source of truth
- The image shows the click location with an ORANGE-RED CIRCLE marker
- If element info is provided, use it to write accurate instructions
- If no element info, identify the UI element from the image

For TYPE actions:
- Reference the exact text the user typed

For CAPTURE actions:
- These are manual screenshots taken to show results or output
- Describe what is visible on the screen (e.g., command output, results, confirmation messages)
- Focus on explaining what the user should observe or verify

Guidelines:
- Write in imperative mood (e.g., "Click the Submit button", "Type 'hello' in the search field")
- For capture steps, describe observations (e.g., "Observe the ping results showing 4 successful replies")
- Be specific about the UI element or output
- Keep to 1-2 sentences
- No step numbers, markdown, or bullet points
- If a user description is provided, incorporate it into your response`;

    let actionDescription: string;
    if (step.type_ === 'click') {
        // Build description with element info if available
        const parts: string[] = [];
        if (step.element_name) parts.push(`Element: "${step.element_name}"`);
        if (step.element_type) parts.push(`Type: ${step.element_type}`);
        if (step.app_name) parts.push(`App: ${step.app_name}`);

        if (parts.length > 0) {
            actionDescription = `User clicked: ${parts.join(', ')}. Coordinates: (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})`;
        } else {
            actionDescription = `User clicked at coordinates (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})`;
        }
    } else if (step.type_ === 'type') {
        actionDescription = `User typed exactly: "${step.text}"`;
    } else {
        // capture type
        actionDescription = `User took a manual screenshot to capture the current screen state/output`;
    }

    // Add user description if provided
    if (step.description) {
        actionDescription += `\n\nUser note: "${step.description}"`;
    }

    // Build context from previous steps
    let contextText = "";
    if (previousSteps.length > 0) {
        contextText = `\n\nPrevious steps in this workflow:\n${previousSteps.map((desc, i) => `${i + 1}. ${desc}`).join('\n')}\n\nUse this context to understand what the user is trying to accomplish.`;
    }

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
            type: "text",
            text: `This is step ${stepNumber} of ${totalSteps}.\n\nAction: ${actionDescription}${contextText}\n\nAnalyze the screenshot and describe what the user should do in this step.`
        }
    ];

    if (screenshotBase64) {
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

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
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
    });

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
            throw new Error("Rate limit exceeded. Please wait a moment and try again.");
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

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
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
    });

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
}

export async function generateDocumentation(steps: StepLike[], config?: AIConfig): Promise<string> {
    // Use provided config or fall back to store
    const storeState = useSettingsStore.getState();
    const openaiApiKey = config?.apiKey ?? storeState.openaiApiKey;
    const openaiBaseUrl = config?.baseUrl || storeState.openaiBaseUrl;
    const openaiModel = config?.model || storeState.openaiModel;
    
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



    // Convert all screenshots to base64 first
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step) => ({
            step,
            screenshotBase64: step.screenshot ? await fileToBase64(step.screenshot) : ""
        }))
    );

    // Generate description for each step with context from previous steps
    const stepDescriptions: string[] = [];
    try {
        for (let i = 0; i < stepsWithBase64.length; i++) {
            const { step, screenshotBase64 } = stepsWithBase64[i];

            // For click steps that haven't been manually cropped, crop image around the click point
            // For manually cropped steps, capture steps, and type steps, use the image as-is
            let imageToSend = screenshotBase64;
            if (step.type_ === 'click' && step.x && step.y && screenshotBase64 && !step.is_cropped) {
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
                openaiModel
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
