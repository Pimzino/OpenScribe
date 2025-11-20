import { Step } from "../store/recorderStore";
import { readFile } from "@tauri-apps/plugin-fs";
import { useSettingsStore } from "../store/settingsStore";

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
            const cropSize = radius * 2;
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

Guidelines:
- Write in imperative mood (e.g., "Click the Submit button", "Type 'hello' in the search field")
- Be specific about the UI element
- Keep to 1-2 sentences
- No step numbers, markdown, or bullet points`;

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
    } else {
        actionDescription = `User typed exactly: "${step.text}"`;
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

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
            model: openaiModel,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent }
            ],
            max_tokens: 256,
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
            `OpenAI API error: ${response.status} ${response.statusText}${
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

    const response = await fetch(`${openaiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
            model: openaiModel,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: `Generate a title for this how-to guide based on these steps:\n\n${stepsText}` }
            ],
            max_tokens: 64,
            temperature: 0.3,
        }),
    });

    if (!response.ok) {
        return "Step-by-Step Guide";
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || "Step-by-Step Guide";
}

export async function generateDocumentation(steps: Step[]): Promise<string> {
    const { openaiBaseUrl, openaiApiKey, openaiModel } = useSettingsStore.getState();

    if (!openaiApiKey) {
        throw new Error("OpenAI API key not configured. Please go to Settings to add your API key.");
    }

    if (steps.length === 0) {
        throw new Error("No steps to generate documentation from.");
    }

    console.log("Generating documentation for", steps.length, "steps");

    // Convert all screenshots to base64 first
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step) => ({
            step,
            screenshotBase64: step.screenshot ? await fileToBase64(step.screenshot) : ""
        }))
    );

    // Generate description for each step with context from previous steps
    const stepDescriptions: string[] = [];
    for (let i = 0; i < stepsWithBase64.length; i++) {
        const { step, screenshotBase64 } = stepsWithBase64[i];

        // For click steps, crop image around the click point
        let imageToSend = screenshotBase64;
        if (step.type_ === 'click' && step.x && step.y && screenshotBase64) {
            imageToSend = await cropAroundPoint(screenshotBase64, step.x, step.y, 300);
        }

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
            // Use file path for local display
            markdown += `![Step ${i + 1} Screenshot](${step.screenshot})\n\n`;
        }
    }

    return markdown;
}
