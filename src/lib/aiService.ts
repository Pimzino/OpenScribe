import { Step } from "../store/recorderStore";
import { readFile } from "@tauri-apps/plugin-fs";
import { useSettingsStore } from "../store/settingsStore";

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
    openaiBaseUrl: string,
    openaiApiKey: string,
    openaiModel: string
): Promise<string> {
    const systemPrompt = `You are a technical documentation writer. Analyze the screenshot and the user action to write a clear, concise instruction for this single step.

Guidelines:
- Write in imperative mood (e.g., "Click the Submit button")
- Be specific about what UI element to interact with
- Include relevant context from what you see in the screenshot
- Keep it to 1-2 sentences
- Do NOT include step numbers, markdown formatting, or bullet points
- Just return the plain instruction text`;

    const actionDescription = step.type_ === 'click'
        ? `User clicked at coordinates (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})`
        : `User typed: "${step.text}"`;

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
            type: "text",
            text: `This is step ${stepNumber} of ${totalSteps}.\n\nAction: ${actionDescription}\n\nAnalyze the screenshot and describe what the user should do in this step.`
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

// Generate a title for the documentation based on the first screenshot
async function generateTitle(
    screenshotBase64: string,
    openaiBaseUrl: string,
    openaiApiKey: string,
    openaiModel: string
): Promise<string> {
    const systemPrompt = `Analyze the screenshot and generate a short, descriptive title for a how-to guide.
Return ONLY the title text, nothing else. Keep it under 10 words.
Example: "How to Create a New Project in VS Code"`;

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
            type: "text",
            text: "Generate a title for this how-to guide based on what you see in the screenshot."
        },
        {
            type: "image_url",
            image_url: {
                url: `data:image/jpeg;base64,${screenshotBase64}`
            }
        }
    ];

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
            max_tokens: 64,
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

    // Generate title from first screenshot
    const firstScreenshot = stepsWithBase64[0]?.screenshotBase64;
    const title = firstScreenshot
        ? await generateTitle(firstScreenshot, openaiBaseUrl, openaiApiKey, openaiModel)
        : "Step-by-Step Guide";

    // Generate description for each step
    const stepDescriptions: string[] = [];
    for (let i = 0; i < stepsWithBase64.length; i++) {
        const { step, screenshotBase64 } = stepsWithBase64[i];
        const description = await generateStepDescription(
            step,
            i + 1,
            steps.length,
            screenshotBase64,
            openaiBaseUrl,
            openaiApiKey,
            openaiModel
        );
        stepDescriptions.push(description);
    }

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
