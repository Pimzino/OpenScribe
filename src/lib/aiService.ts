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
import {
    buildSystemPrompt,
    buildCoherenceSystemPrompt,
    buildElementIdentifySystemPrompt,
    buildInstructionWriteSystemPrompt,
    COHERENCE_STEP_DELIMITER,
} from "./promptConstants";
import { normalizePathForMarkdown } from "./pathUtils";
import { log, describeError } from "./logger";

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
    const modelName = typeof body?.model === "string" ? body.model : "<unknown>";
    log.ai.debug("Dispatching chat completion to backend", {
        baseUrl: openaiBaseUrl,
        model: modelName,
        autoRetry: config.enableAutoRetry,
        maxRetryAttempts: config.maxRetryAttempts,
    });
    try {
        const result = await invoke<string>("ai_chat_completion", {
            baseUrl: openaiBaseUrl,
            apiKey: openaiApiKey,
            body,
            retryConfig: {
                enableAutoRetry: config.enableAutoRetry,
                maxRetryAttempts: config.maxRetryAttempts,
                initialRetryDelayMs: config.initialRetryDelayMs,
            },
        });
        log.ai.debug("Chat completion returned", {
            model: modelName,
            responseChars: result?.length ?? 0,
        });
        return result;
    } catch (error) {
        const described = describeError(error);
        log.ai.error("Chat completion failed", {
            model: modelName,
            baseUrl: openaiBaseUrl,
            ...described.metadata,
        });
        throw error;
    }
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

// Action-type-aware fallback when the model returns nothing usable.
// Better than the original "Perform this action." which the prompts now forbid.
function buildStepFallback(step: { type_: string; text?: string }): string {
    if (step.type_ === "click") {
        return "Click the highlighted element in the screenshot.";
    }
    if (step.type_ === "type") {
        const raw = step.text?.trim();
        if (raw) {
            // Escape any double-quotes the user actually typed so the fallback stays well-formed.
            const escaped = raw.replace(/"/g, '\\"');
            return `Type "${escaped}" into the focused field.`;
        }
        return "Enter the recorded text in the focused field.";
    }
    if (step.type_ === "capture") {
        return "Verify the screen state shown in the screenshot.";
    }
    return "Continue with the next part of the workflow.";
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
    screenshotAfterBase64: string | null,
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

        // Always include OCR text as supplementary signal — even with screenshots on,
        // the cropped/dense UI may have small or stylized text the vision model misreads.
        if (step.ocr_text) {
            const truncatedOcr = step.ocr_text.length > 200
                ? step.ocr_text.substring(0, 200) + '...'
                : step.ocr_text;
            parts.push(`Nearby visible text (OCR): "${truncatedOcr}"`);
        }

        parts.push(`Click location: (${Math.round(step.x || 0)}, ${Math.round(step.y || 0)})`);
        parts.push(`Write an instruction telling the user to click this element.`);
        actionDescription = parts.join('\n');
    } else if (step.type_ === 'type') {
        actionDescription = `ACTION: TYPE
Typed text: "${step.text}"
NOTE: The typed text may be partial (for autocomplete) or abbreviated. If user context provides more specific information (like a full URL, file path, or complete value), use that instead of the literal typed text.
Write an instruction that achieves the user's intent.`;
        if (step.ocr_text) {
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
        if (step.ocr_text) {
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

    const hasAfterFrame = sendScreenshots && Boolean(screenshotAfterBase64);
    const twoFrameNote = hasAfterFrame
        ? `\n\nIMPORTANT: TWO SCREENSHOTS are provided for this step.\n- Image 1 (BEFORE): the screen at the moment of the action. For click steps it shows the click location marked with an orange-red circle.\n- Image 2 (AFTER): the screen ~700ms after the action.\nCompare the two frames. If something changed (panel opened, page loaded, field filled, menu appeared), reflect that outcome in the instruction. If the frames look essentially identical, write the instruction based on the BEFORE frame alone.`
        : "";

    const buildPromptText = (contextEntries: string[]) => {
        const contextText = buildWorkflowContext(workflowTitle, contextEntries);
        return sendScreenshots
            ? `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}${twoFrameNote}\n\nTASK: Write ONE clear instruction sentence for this step. Use the screenshot${hasAfterFrame ? "s" : ""} to identify UI elements accurately.`
            : `Step ${stepNumber} of ${totalSteps}\n\n${actionDescription}${contextText}\n\nTASK: Write ONE clear instruction sentence for this step based on the metadata provided.`;
    };

    // Two images cost roughly twice the image-token budget. The aiPolicy layer
    // already reserves a per-image estimate; we pass image count via includeImage
    // and account for the after-frame here by widening the reservation when present.
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
            text: promptText,
        },
    ];

    if (sendScreenshots && screenshotBase64) {
        userContent.push({
            type: "image_url",
            image_url: {
                url: `data:image/jpeg;base64,${screenshotBase64}`,
            },
        });
    }

    // Pass the after-frame as a second image when available. All major
    // OpenAI-compatible providers (OpenAI, Anthropic via compat, OpenRouter,
    // Gemini-compat) accept multiple image_url entries in a single user message.
    if (hasAfterFrame && screenshotAfterBase64) {
        userContent.push({
            type: "image_url",
            image_url: {
                url: `data:image/jpeg;base64,${screenshotAfterBase64}`,
            },
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
        return buildStepFallback(step);
    }

    if (contextBudget.droppedEntries > 0) {
        console.warn(
            `[AI Service] Trimmed ${contextBudget.droppedEntries} previous step(s) to fit model budget. ${formatPolicySummary(policy)}`
        );
    }

    // Strip any reasoning/thinking content from the response
    const stripped = stripReasoningContent(rawContent);
    return stripped || buildStepFallback(step);
}

// ============================================
// TWO-STAGE PROMPTING (6a)
// ============================================

interface IdentifiedElement {
    element_label: string;
    element_role: string;
    element_location: string;
    outcome: string;
    confidence: string;
}

/**
 * Parse Stage A's JSON output, tolerating common LLM quirks: code-fence
 * wrapping, leading/trailing prose, escaped braces. Returns null on any
 * failure so the orchestrator can fall back to single-call mode.
 */
function parseIdentifiedElement(raw: string): IdentifiedElement | null {
    if (!raw) return null;
    const stripped = stripReasoningContent(raw).trim();
    // Try direct parse first.
    let candidate = stripped;
    // Strip ```json ... ``` or ``` ... ``` fences if present.
    const fenceMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) candidate = fenceMatch[1].trim();
    // If there's prose around a JSON object, extract the first balanced { ... }.
    if (!candidate.startsWith("{")) {
        const objMatch = candidate.match(/\{[\s\S]*\}/);
        if (objMatch) candidate = objMatch[0];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(candidate);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    const label = typeof obj.element_label === "string" ? obj.element_label.trim() : "";
    if (!label) return null;
    return {
        element_label: label,
        element_role: typeof obj.element_role === "string" ? obj.element_role : "",
        element_location: typeof obj.element_location === "string" ? obj.element_location : "",
        outcome: typeof obj.outcome === "string" ? obj.outcome : "",
        confidence: typeof obj.confidence === "string" ? obj.confidence : "",
    };
}

/**
 * Stage A — vision call that identifies the UI element and the action's
 * visible outcome, returning structured JSON. Returns null on any failure
 * (no API output, unparseable JSON, missing required field).
 */
async function identifyElement(
    step: Step & { ocr_text?: string; identified_element_json?: string },
    screenshotBase64: string | null,
    screenshotAfterBase64: string | null,
    openaiBaseUrl: string,
    openaiApiKey: string,
    aiProviderId: string,
    openaiModel: string,
    sendScreenshots: boolean,
    workflowTitle: string | undefined,
): Promise<IdentifiedElement | null> {
    // Cache short-circuit — skip the vision call if a prior identification
    // is already attached to this step.
    if (step.identified_element_json) {
        const cached = parseIdentifiedElement(step.identified_element_json);
        if (cached) return cached;
    }

    const providerConfig = getProvider(aiProviderId);
    const policy = resolveModelPolicy({
        providerId: providerConfig?.id ?? "custom",
        model: openaiModel,
        purpose: "element-identify",
        supportsVision: providerConfig?.supportsVision ?? true,
        settings: getAdvancedAiSettings(),
    });

    const systemPrompt = buildElementIdentifySystemPrompt();

    const metaParts: string[] = [];
    metaParts.push(`ACTION: ${step.type_.toUpperCase()}`);
    if (step.element_name) metaParts.push(`Element name: "${step.element_name}"`);
    if (step.element_type) metaParts.push(`Element type: ${step.element_type}`);
    if (step.app_name) metaParts.push(`Application: ${step.app_name}`);
    if (step.type_ === "click" && step.x !== undefined && step.y !== undefined) {
        metaParts.push(`Click position: (${Math.round(step.x)}, ${Math.round(step.y)})`);
    }
    if (step.type_ === "type" && step.text) {
        metaParts.push(`Typed text: "${step.text}"`);
    }
    if (step.ocr_text) {
        const ocrTrunc = step.ocr_text.length > 300 ? step.ocr_text.substring(0, 300) + "..." : step.ocr_text;
        metaParts.push(`OCR text near the action: "${ocrTrunc}"`);
    }
    if (step.description) {
        metaParts.push(`User-provided context: "${step.description}"`);
    }
    if (workflowTitle) {
        metaParts.push(`Workflow goal: "${workflowTitle}"`);
    }

    const hasAfter = sendScreenshots && Boolean(screenshotAfterBase64);
    const userText = `${metaParts.join("\n")}\n\nReturn ONE JSON object with the required shape. No prose, no markdown.${hasAfter ? "\n\nYou have two screenshots: image 1 is BEFORE the action, image 2 is AFTER (~700ms later). Use the diff for the 'outcome' field." : "\n\nYou have one screenshot showing the moment of the action. The 'outcome' field should be an empty string."}`;

    const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: "text", text: userText },
    ];
    if (sendScreenshots && screenshotBase64) {
        userContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotBase64}` } });
    }
    if (hasAfter && screenshotAfterBase64) {
        userContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${screenshotAfterBase64}` } });
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
            rateLimitConfig,
        );
    } catch (error) {
        console.warn("[AI Service] Stage A (identify) failed; falling back to single-call.", withPolicyDiagnostics(error, policy));
        return null;
    }

    const parsed = parseIdentifiedElement(rawContent);
    if (!parsed) {
        console.warn("[AI Service] Stage A returned unparseable JSON; falling back to single-call.");
    }
    return parsed;
}

/**
 * Stage B — text-only call that writes the final imperative instruction
 * from Stage A's structured output plus workflow context.
 */
async function writeInstruction(
    step: Step,
    identification: IdentifiedElement,
    previousSteps: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    aiProviderId: string,
    openaiModel: string,
    workflowTitle: string | undefined,
): Promise<string> {
    const writingStyle = useSettingsStore.getState().writingStyle;
    const systemPrompt = buildInstructionWriteSystemPrompt(writingStyle);

    const providerConfig = getProvider(aiProviderId);
    const policy = resolveModelPolicy({
        providerId: providerConfig?.id ?? "custom",
        model: openaiModel,
        purpose: "instruction-write",
        supportsVision: providerConfig?.supportsVision ?? true,
        settings: getAdvancedAiSettings(),
    });

    const buildText = (contextEntries: string[]) => {
        const ctx = buildWorkflowContext(workflowTitle, contextEntries);
        const typedTextLine = step.type_ === "type" && step.text
            ? `\nTyped text (preserve verbatim): "${step.text}"`
            : "";
        const userDescription = step.description
            ? `\nUser-provided intent context: "${step.description}"`
            : "";
        return `IDENTIFICATION (from vision pass):
- Element: ${identification.element_label}
- Role: ${identification.element_role || "unknown"}
- Location: ${identification.element_location || "unknown"}
- Outcome: ${identification.outcome || "(none)"}
- Confidence: ${identification.confidence || "unknown"}

ACTION TYPE: ${step.type_.toUpperCase()}${typedTextLine}${userDescription}${ctx}

Write ONE imperative instruction sentence describing what the reader should do in this step. Include the outcome only when it adds clarity AND is not "no visible change" or empty.`;
    };

    const contextBudget = fitContextEntriesToBudget({
        contextEntries: previousSteps,
        buildPromptText: buildText,
        fixedTextParts: [systemPrompt],
        includeImage: false,
        policy,
    });
    const userText = buildText(contextBudget.retainedEntries);

    const rateLimitConfig = getRateLimitConfig();
    let rawContent: string;
    try {
        rawContent = await requestAiChatCompletion(
            openaiBaseUrl,
            openaiApiKey,
            buildChatCompletionBody(policy, openaiModel, [
                { role: "system", content: systemPrompt },
                { role: "user", content: userText },
            ]),
            rateLimitConfig,
        );
    } catch (error) {
        console.warn("[AI Service] Stage B (write) failed; using fallback.", withPolicyDiagnostics(error, policy));
        return buildStepFallback(step);
    }

    const stripped = stripReasoningContent(rawContent);
    return stripped || buildStepFallback(step);
}

/**
 * Orchestrator. Runs Stage A then Stage B. If Stage A fails (no parseable
 * output), falls back to the single-call generateStepDescription path so
 * the document is never worse than the single-stage flow.
 *
 * If Stage A succeeded and a row id is available, persists the identification
 * JSON via update_step_identified_element so subsequent regenerations skip
 * the vision call.
 */
async function generateStepDescriptionMultiStage(
    step: Step & { ocr_text?: string; identified_element_json?: string; id?: string },
    stepNumber: number,
    totalSteps: number,
    screenshotBase64: string | null,
    screenshotAfterBase64: string | null,
    previousSteps: string[],
    openaiBaseUrl: string,
    openaiApiKey: string,
    aiProviderId: string,
    openaiModel: string,
    sendScreenshots: boolean,
    workflowTitle: string | undefined,
): Promise<string> {
    const identification = await identifyElement(
        step,
        screenshotBase64,
        screenshotAfterBase64,
        openaiBaseUrl,
        openaiApiKey,
        aiProviderId,
        openaiModel,
        sendScreenshots,
        workflowTitle,
    );

    if (!identification) {
        // Fall back to single-call path so the user never loses a step output.
        return generateStepDescription(
            step,
            stepNumber,
            totalSteps,
            screenshotBase64,
            screenshotAfterBase64,
            previousSteps,
            openaiBaseUrl,
            openaiApiKey,
            aiProviderId,
            openaiModel,
            sendScreenshots,
            workflowTitle,
        );
    }

    // Persist cache for future regenerations. Skip when the step doesn't have
    // a persisted DB id yet (live recording — will be written when save_steps runs).
    if (step.id && !step.id.startsWith("temp-") && !step.identified_element_json) {
        try {
            await invoke("update_step_identified_element", {
                stepId: step.id,
                identifiedElementJson: JSON.stringify(identification),
            });
        } catch (error) {
            // Caching failure is non-fatal.
            console.warn("[AI Service] Failed to persist Stage A cache:", error);
        }
    }

    return writeInstruction(
        step,
        identification,
        previousSteps,
        openaiBaseUrl,
        openaiApiKey,
        aiProviderId,
        openaiModel,
        workflowTitle,
    );
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

// Parse the refined-document response from the coherence pass.
// Expected shape (per step):
//   ### STEP 1 ###
//   <refined text...>
//   ### STEP 2 ###
//   <refined text...>
// Returns refined text per index. Any step that cannot be located in the
// response is returned as `null` so the caller can fall back to the original.
function parseCoherenceResponse(
    rawResponse: string,
    expectedStepCount: number
): (string | null)[] {
    const result: (string | null)[] = new Array(expectedStepCount).fill(null);
    if (!rawResponse) return result;

    // Match each delimiter, regardless of surrounding whitespace.
    // Captures the step number and records both the line's start (for slicing the
    // previous step's text up to here) and its end (where the next step's text begins).
    const delimiterPattern = /^[ \t]*###\s*STEP\s+(\d+)\s*###[ \t]*$/gim;
    interface Marker {
        stepIndex: number; // zero-based
        delimiterStart: number;
        textStart: number;
    }

    const markers: Marker[] = [];
    let match: RegExpExecArray | null;
    while ((match = delimiterPattern.exec(rawResponse)) !== null) {
        const stepNumber = parseInt(match[1], 10);
        if (Number.isFinite(stepNumber) && stepNumber >= 1 && stepNumber <= expectedStepCount) {
            markers.push({
                stepIndex: stepNumber - 1,
                delimiterStart: match.index,
                textStart: match.index + match[0].length,
            });
        }
    }

    for (let i = 0; i < markers.length; i++) {
        const start = markers[i].textStart;
        const end = i + 1 < markers.length ? markers[i + 1].delimiterStart : rawResponse.length;
        const text = rawResponse.slice(start, end).trim();
        if (!text) continue;
        // If the same step appears twice, keep the first occurrence to avoid silent overwrites.
        if (result[markers[i].stepIndex] === null) {
            result[markers[i].stepIndex] = text;
        }
    }

    return result;
}

// Run a single document-wide coherence pass over all generated step descriptions.
// Returns refined descriptions on success. On any failure (no API output, parse
// failure, count mismatch, abort) it logs and returns the originals untouched
// per-step so the document never gets worse than the per-step output.
async function refineDocumentCoherence(
    originalDescriptions: string[],
    workflowTitle: string | undefined,
    openaiBaseUrl: string,
    openaiApiKey: string,
    aiProviderId: string,
    openaiModel: string,
    abortSignal?: AbortSignal
): Promise<string[]> {
    if (originalDescriptions.length === 0) return originalDescriptions;
    if (abortSignal?.aborted) {
        throw new DOMException("Generation cancelled", "AbortError");
    }

    const writingStyle = useSettingsStore.getState().writingStyle;
    const systemPrompt = buildCoherenceSystemPrompt(writingStyle);

    const providerConfig = getProvider(aiProviderId);
    const policy = resolveModelPolicy({
        providerId: providerConfig?.id ?? "custom",
        model: openaiModel,
        purpose: "coherence-pass",
        supportsVision: providerConfig?.supportsVision ?? true,
        settings: getAdvancedAiSettings(),
    });

    const totalSteps = originalDescriptions.length;
    const titleLine = workflowTitle
        ? `WORKFLOW GOAL: "${workflowTitle}"\nUse this goal to keep the refined steps aligned with the user's objective.\n\n`
        : "";
    const inputBlock = originalDescriptions
        .map((desc, i) => `${COHERENCE_STEP_DELIMITER} ${i + 1} ###\n${desc}`)
        .join("\n");
    const userPrompt = `${titleLine}You will refine the following ${totalSteps} step instruction(s) so they flow as a connected guide. Return EXACTLY ${totalSteps} refined step(s) in the required delimiter format.

ORIGINAL STEPS:
${inputBlock}

Now return the refined steps using the exact "${COHERENCE_STEP_DELIMITER} N ###" format, with N from 1 to ${totalSteps}.`;

    // Skip the pass if the prompt would exceed the model's context budget.
    const approxPromptTokens = Math.ceil(
        (systemPrompt.length + userPrompt.length) / 4
    );
    if (approxPromptTokens > policy.promptTokenBudget) {
        console.warn(
            `[AI Service] Skipping coherence pass: prompt ~${approxPromptTokens} tokens exceeds budget ${policy.promptTokenBudget}. ${formatPolicySummary(policy)}`
        );
        return originalDescriptions;
    }

    const rateLimitConfig = getRateLimitConfig();
    let rawContent: string;
    try {
        rawContent = await requestAiChatCompletion(
            openaiBaseUrl,
            openaiApiKey,
            buildChatCompletionBody(policy, openaiModel, [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ]),
            rateLimitConfig
        );
    } catch (error) {
        console.error("[AI Service] Coherence pass failed; keeping per-step output.", withPolicyDiagnostics(error, policy));
        return originalDescriptions;
    }

    if (abortSignal?.aborted) {
        throw new DOMException("Generation cancelled", "AbortError");
    }

    const stripped = stripReasoningContent(rawContent);
    if (!stripped) {
        console.warn("[AI Service] Coherence pass returned empty content; keeping per-step output.");
        return originalDescriptions;
    }

    const parsed = parseCoherenceResponse(stripped, totalSteps);
    const matchedCount = parsed.filter(entry => entry !== null).length;

    if (matchedCount === 0) {
        console.warn("[AI Service] Coherence pass produced no parseable steps; keeping per-step output.");
        return originalDescriptions;
    }

    if (matchedCount < totalSteps) {
        console.warn(
            `[AI Service] Coherence pass returned ${matchedCount}/${totalSteps} steps; using originals for the rest.`
        );
    }

    return originalDescriptions.map((original, i) => parsed[i] ?? original);
}

interface AIConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    workflowTitle?: string;
}

interface StepLike {
    /** DB row id, used as the Stage A cache key for multi-stage prompting. */
    id?: string;
    type_: string;
    x?: number;
    y?: number;
    text?: string;
    timestamp: number;
    screenshot?: string;
    screenshot_after?: string;
    element_name?: string;
    element_type?: string;
    element_value?: string;
    app_name?: string;
    description?: string;
    is_cropped?: boolean;
    ocr_text?: string;
    ocr_status?: string;
    input_source?: string;
    identified_element_json?: string;
    clip_path?: string;
}

export async function generateDocumentation(steps: StepLike[], config?: AIConfig): Promise<string> {
    // Use provided config or fall back to store
    const storeState = useSettingsStore.getState();
    const openaiApiKey = config?.apiKey ?? storeState.openaiApiKey;
    const openaiBaseUrl = config?.baseUrl || storeState.openaiBaseUrl;
    const openaiModel = config?.model || storeState.openaiModel;
    const aiProviderId = storeState.aiProvider;
    const sendScreenshotsToAi = storeState.sendScreenshotsToAi;
    const enableStateDiff = storeState.enableStateDiff !== false;
    const enableCoherencePass = storeState.enableCoherencePass !== false;
    const enableMultiStage = storeState.enableMultiStagePrompting === true;

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

    // Convert all screenshots (and after-frames when present) to base64 upfront.
    // Skip after-frame resolution entirely when state-diff is disabled.
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step) => ({
            step,
            screenshotBase64: sendScreenshotsToAi && step.screenshot
                ? await fileToBase64(step.screenshot)
                : null,
            screenshotAfterBase64: enableStateDiff && sendScreenshotsToAi && step.screenshot_after
                ? await fileToBase64(step.screenshot_after)
                : null,
        }))
    );

    // Generate description for each step with context from previous steps
    const stepDescriptions: string[] = [];
    const rateLimitConfig = getRateLimitConfig();
    try {
        for (let i = 0; i < stepsWithBase64.length; i++) {
            const { step, screenshotBase64, screenshotAfterBase64 } = stepsWithBase64[i];

            // Apply throttling delay between requests (not before the first one)
            if (i > 0 && rateLimitConfig.enableRequestThrottling && rateLimitConfig.throttleDelayMs > 0) {
                await sleep(rateLimitConfig.throttleDelayMs);
            }

            const description = enableMultiStage
                ? await generateStepDescriptionMultiStage(
                      step,
                      i + 1,
                      steps.length,
                      screenshotBase64,
                      screenshotAfterBase64,
                      stepDescriptions.slice(),
                      openaiBaseUrl,
                      openaiApiKey,
                      aiProviderId,
                      openaiModel,
                      sendScreenshotsToAi,
                      config?.workflowTitle,
                  )
                : await generateStepDescription(
                      step,
                      i + 1,
                      steps.length,
                      screenshotBase64,
                      screenshotAfterBase64,
                      stepDescriptions.slice(),
                      openaiBaseUrl,
                      openaiApiKey,
                      aiProviderId,
                      openaiModel,
                      sendScreenshotsToAi,
                      config?.workflowTitle,
                  );
            stepDescriptions.push(description);
        }
    } catch (error) {
        throw error;
    }

    // Document-wide coherence pass — see generateDocumentationStreaming for rationale.
    // Skipped when the user has disabled it in settings (avoids the extra LLM call).
    if (enableCoherencePass && stepDescriptions.length > 1) {
        try {
            const refined = await refineDocumentCoherence(
                stepDescriptions,
                config?.workflowTitle,
                openaiBaseUrl,
                openaiApiKey,
                aiProviderId,
                openaiModel
            );
            for (let i = 0; i < refined.length; i++) {
                stepDescriptions[i] = refined[i];
            }
        } catch (error) {
            console.error("[AI Service] Coherence pass threw unexpectedly; keeping per-step output.", error);
        }
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
    // Document-wide coherence pass lifecycle (after all per-step generation).
    onPolishStart?: () => void;
    onPolishComplete?: (refinedDescriptions: string[]) => void;
}

// Generate step description with streaming
async function generateStepDescriptionStreaming(
    step: Step & { ocr_text?: string },
    stepNumber: number,
    totalSteps: number,
    screenshotBase64: string | null,
    screenshotAfterBase64: string | null,
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
        screenshotAfterBase64,
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
    const enableStateDiff = storeState.enableStateDiff !== false;
    const enableCoherencePass = storeState.enableCoherencePass !== false;
    const enableMultiStage = storeState.enableMultiStagePrompting === true;

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

    // Convert all screenshots (and after-frames when present) to base64 upfront.
    // Skip after-frame resolution entirely when state-diff is disabled.
    const stepsWithBase64 = await Promise.all(
        steps.map(async (step) => ({
            step,
            screenshotBase64: sendScreenshotsToAi && step.screenshot
                ? await fileToBase64(step.screenshot)
                : null,
            screenshotAfterBase64: enableStateDiff && sendScreenshotsToAi && step.screenshot_after
                ? await fileToBase64(step.screenshot_after)
                : null,
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

            const { step, screenshotBase64, screenshotAfterBase64 } = stepsWithBase64[i];

            // Apply throttling delay between requests
            if (i > 0 && rateLimitConfig.enableRequestThrottling && rateLimitConfig.throttleDelayMs > 0) {
                await sleep(rateLimitConfig.throttleDelayMs);
            }

            // Send the full screenshot as captured — see generateDocumentation for rationale.
            try {
                let description: string;
                if (enableMultiStage) {
                    if (abortSignal?.aborted) {
                        throw new DOMException("Generation cancelled", "AbortError");
                    }
                    description = await generateStepDescriptionMultiStage(
                        step,
                        i + 1,
                        steps.length,
                        screenshotBase64,
                        screenshotAfterBase64,
                        stepDescriptions.slice(),
                        openaiBaseUrl,
                        openaiApiKey,
                        aiProviderId,
                        openaiModel,
                        sendScreenshotsToAi,
                        config?.workflowTitle,
                    );
                    // Multi-stage doesn't natively stream — emit the full text
                    // as one chunk so the UI's streaming view still updates.
                    callbacks.onTextChunk?.(i, description);
                } else {
                    description = await generateStepDescriptionStreaming(
                        step,
                        i + 1,
                        steps.length,
                        screenshotBase64,
                        screenshotAfterBase64,
                        stepDescriptions.slice(),
                        openaiBaseUrl,
                        openaiApiKey,
                        aiProviderId,
                        openaiModel,
                        sendScreenshotsToAi,
                        (chunk) => callbacks.onTextChunk?.(i, chunk),
                        abortSignal,
                        config?.workflowTitle,
                    );
                }

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

    // Document-wide coherence pass: take the per-step output and rewrite it so
    // the guide reads as a connected walkthrough (transitions, references to
    // earlier steps, less robotic repetition). Falls back to per-step output
    // on any failure so the result is never worse than before. Honors the
    // user's enableCoherencePass setting.
    if (enableCoherencePass && stepDescriptions.length > 1) {
        callbacks.onPolishStart?.();
        try {
            const refined = await refineDocumentCoherence(
                stepDescriptions,
                config?.workflowTitle,
                openaiBaseUrl,
                openaiApiKey,
                aiProviderId,
                openaiModel,
                abortSignal
            );
            for (let i = 0; i < refined.length; i++) {
                stepDescriptions[i] = refined[i];
            }
            callbacks.onPolishComplete?.(refined.slice());
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") {
                throw error;
            }
            // Non-abort errors already log inside refineDocumentCoherence and return originals,
            // but if something else bubbled up we keep the per-step output.
            console.error("[AI Service] Coherence pass threw unexpectedly; keeping per-step output.", error);
            callbacks.onPolishComplete?.(stepDescriptions.slice());
        }
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
