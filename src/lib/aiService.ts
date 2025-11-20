import { Step } from "../store/recorderStore";
import { readFile } from "@tauri-apps/plugin-fs";
import { convertFileSrc } from "@tauri-apps/api/core";

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

// Mock AI service for now, can be replaced with OpenAI call
export async function generateDocumentation(steps: Step[]): Promise<string> {
    console.log("Generating documentation for steps:", steps);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Convert file paths to base64 for AI processing
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step) => {
            if (step.screenshot) {
                const base64 = await fileToBase64(step.screenshot);
                return { ...step, screenshotBase64: base64 };
            }
            return { ...step, screenshotBase64: "" };
        })
    );

    return `
# Generated Documentation

This guide was automatically generated based on your recorded actions.

## Steps

${stepsWithBase64.map((step, index) => `
### Step ${index + 1}
**Action**: ${step.type_ === 'click' ? `Clicked at coordinates (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})` : `Typed: "${step.text}"`}
**Time**: ${new Date(step.timestamp).toLocaleTimeString()}

![Screenshot](data:image/jpeg;base64,${step.screenshotBase64})
`).join("\n")}
  `;
}
