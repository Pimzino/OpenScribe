import { Step } from "../store/recorderStore";

// Mock AI service for now, can be replaced with OpenAI call
export async function generateDocumentation(steps: Step[]): Promise<string> {
    console.log("Generating documentation for steps:", steps);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    return `
# Generated Documentation

This guide was automatically generated based on your recorded actions.

## Steps

${steps.map((step, index) => `
### Step ${index + 1}
**Action**: ${step.type_ === 'click' ? `Clicked at coordinates (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})` : `Typed: "${step.text}"`}
**Time**: ${new Date(step.timestamp).toLocaleTimeString()}

![Screenshot](data:image/jpeg;base64,${step.screenshot})
`).join("\n")}
  `;
}
