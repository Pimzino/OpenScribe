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

export async function generateDocumentation(steps: Step[]): Promise<string> {
    const { openaiBaseUrl, openaiApiKey, openaiModel } = useSettingsStore.getState();

    if (!openaiApiKey) {
        throw new Error("OpenAI API key not configured. Please go to Settings to add your API key.");
    }

    console.log("Generating documentation for steps:", steps);

    // Convert file paths to base64 for AI processing
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step, index) => {
            let screenshotBase64 = "";
            if (step.screenshot) {
                screenshotBase64 = await fileToBase64(step.screenshot);
            }
            return {
                stepNumber: index + 1,
                type: step.type_,
                x: step.x,
                y: step.y,
                text: step.text,
                timestamp: new Date(step.timestamp).toLocaleTimeString(),
                screenshotBase64,
            };
        })
    );

    // Build messages for OpenAI
    const systemPrompt = `You are a technical documentation writer. Your task is to convert user actions (clicks and typed text) into clear, professional step-by-step documentation.

For each step, analyze the screenshot to understand:
- What application or webpage is being used
- What UI element was clicked (button, link, menu item, etc.)
- The context and purpose of the action

Write documentation that is:
- Clear and concise
- Uses proper technical writing style
- Describes what the user should do (imperative mood)
- Includes relevant context from the screenshot

Format the output as Markdown with numbered steps.`;

    // Build content array with text and images
    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        {
            type: "text",
            text: `Please analyze these ${steps.length} recorded actions and generate step-by-step documentation:\n\n` +
                stepsWithBase64.map(step =>
                    `Step ${step.stepNumber}: ${step.type === 'click' ? `Click at (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})` : `Typed: "${step.text}"`} at ${step.timestamp}`
                ).join('\n')
        }
    ];

    // Add screenshots as images
    for (const step of stepsWithBase64) {
        if (step.screenshotBase64) {
            userContent.push({
                type: "image_url",
                image_url: {
                    url: `data:image/jpeg;base64,${step.screenshotBase64}`
                }
            });
        }
    }

    // Call OpenAI API
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
            max_tokens: 4096,
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
    const generatedContent = data.choices?.[0]?.message?.content;

    if (!generatedContent) {
        throw new Error("No content generated from OpenAI");
    }

    return generatedContent;
}
