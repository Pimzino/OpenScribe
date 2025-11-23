import { Step } from "../store/recordingsStore";

/**
 * Interface for steps in the format expected by generateDocumentation()
 */
export interface StepLike {
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
}

/**
 * Maps database steps to the format expected by generateDocumentation()
 * 
 * @param steps - Array of steps from the database (with screenshot_path)
 * @returns Array of steps formatted for AI generation (with screenshot)
 */
export function mapStepsForAI(steps: Step[]): StepLike[] {
    return steps.map(step => ({
        type_: step.type_,
        x: step.x,
        y: step.y,
        text: step.text,
        timestamp: step.timestamp,
        screenshot: step.screenshot_path,
        element_name: step.element_name,
        element_type: step.element_type,
        element_value: step.element_value,
        app_name: step.app_name,
    }));
}
