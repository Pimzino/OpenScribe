import type { AIProviderId } from "./providers";

export type AiRequestPurpose = "step-description" | "title";

export interface AdvancedAiSettings {
    useProviderDefaults: boolean;
    temperatureOverride: number | null;
    outputTokenLimitOverride: number | null;
    contextWindowOverride: number | null;
}

export interface ModelCapabilityRule {
    id: string;
    match: RegExp;
    contextWindow?: number;
    maxOutputTokens?: Partial<Record<AiRequestPurpose, number>>;
    temperature?: number;
    omitTemperature?: boolean;
    supportsVision?: boolean;
    reasoningModel?: boolean;
    notes?: string;
}

export interface ProviderCapability {
    providerId: AIProviderId;
    defaultContextWindow: number;
    defaultTemperature: number;
    defaultOutputTokens: Record<AiRequestPurpose, number>;
    promptSafetyBuffer: number;
    estimatedImageTokens: number;
    modelRules: ModelCapabilityRule[];
}

export interface ResolvedModelPolicy {
    providerId: AIProviderId;
    model: string;
    purpose: AiRequestPurpose;
    contextWindow: number;
    maxOutputTokens: number;
    reservedOutputTokens: number;
    promptTokenBudget: number;
    temperature: number | null;
    supportsVision: boolean;
    reasoningModel: boolean;
    matchedRuleId: string | null;
    promptSafetyBuffer: number;
    estimatedImageTokens: number;
    usedManualTemperature: boolean;
    usedManualOutputLimit: boolean;
    usedManualContextWindow: boolean;
    notes: string[];
}

export interface ContextBudgetResult {
    retainedEntries: string[];
    droppedEntries: number;
    estimatedPromptTokens: number;
}

interface ResolveModelPolicyInput {
    providerId: AIProviderId;
    model: string;
    purpose: AiRequestPurpose;
    supportsVision: boolean;
    settings: AdvancedAiSettings;
}

interface FitContextEntriesInput {
    contextEntries: string[];
    buildPromptText: (entries: string[]) => string;
    fixedTextParts: string[];
    includeImage: boolean;
    policy: ResolvedModelPolicy;
}

const DEFAULT_TEMPERATURE = 0.3;
const DEFAULT_STEP_OUTPUT_TOKENS = 128;
const DEFAULT_TITLE_OUTPUT_TOKENS = 64;
const DEFAULT_PROMPT_SAFETY_BUFFER = 1024;
const DEFAULT_ESTIMATED_IMAGE_TOKENS = 1536;
const APPROX_CHARS_PER_TOKEN = 4;
const BASE_MESSAGE_OVERHEAD_TOKENS = 48;
const MINIMUM_PROMPT_BUDGET = 512;

const REASONING_RULES: ModelCapabilityRule[] = [
    {
        id: "reasoning-openai",
        match: /\b(o1|o3|gpt-5|gpt-5-mini|gpt-5-nano)\b/i,
        contextWindow: 200_000,
        omitTemperature: true,
        reasoningModel: true,
        supportsVision: true,
        notes: "Reasoning-capable OpenAI family",
    },
    {
        id: "reasoning-open-source",
        match: /\b(deepseek-r1|qwq|qwen3|qwen-?r|r1)\b/i,
        contextWindow: 32_768,
        omitTemperature: true,
        reasoningModel: true,
        notes: "Reasoning-focused open model family",
    },
];

const CAPABILITY_REGISTRY: Record<AIProviderId, ProviderCapability> = {
    openai: {
        providerId: "openai",
        defaultContextWindow: 128_000,
        defaultTemperature: DEFAULT_TEMPERATURE,
        defaultOutputTokens: {
            "step-description": DEFAULT_STEP_OUTPUT_TOKENS,
            title: DEFAULT_TITLE_OUTPUT_TOKENS,
        },
        promptSafetyBuffer: DEFAULT_PROMPT_SAFETY_BUFFER,
        estimatedImageTokens: DEFAULT_ESTIMATED_IMAGE_TOKENS,
        modelRules: [
            ...REASONING_RULES,
            {
                id: "openai-gpt-4-family",
                match: /\b(gpt-4\.1|gpt-4o|gpt-4-turbo|gpt-4)\b/i,
                contextWindow: 128_000,
                supportsVision: true,
                notes: "GPT-4 class multimodal models",
            },
        ],
    },
    openrouter: {
        providerId: "openrouter",
        defaultContextWindow: 128_000,
        defaultTemperature: DEFAULT_TEMPERATURE,
        defaultOutputTokens: {
            "step-description": DEFAULT_STEP_OUTPUT_TOKENS,
            title: DEFAULT_TITLE_OUTPUT_TOKENS,
        },
        promptSafetyBuffer: DEFAULT_PROMPT_SAFETY_BUFFER,
        estimatedImageTokens: DEFAULT_ESTIMATED_IMAGE_TOKENS,
        modelRules: [
            ...REASONING_RULES,
            {
                id: "openrouter-openai-family",
                match: /\b(openai\/gpt-4\.1|openai\/gpt-4o|openai\/o1|openai\/o3)\b/i,
                contextWindow: 128_000,
                supportsVision: true,
                notes: "OpenRouter OpenAI family",
            },
        ],
    },
    anthropic: {
        providerId: "anthropic",
        defaultContextWindow: 200_000,
        defaultTemperature: DEFAULT_TEMPERATURE,
        defaultOutputTokens: {
            "step-description": DEFAULT_STEP_OUTPUT_TOKENS,
            title: DEFAULT_TITLE_OUTPUT_TOKENS,
        },
        promptSafetyBuffer: DEFAULT_PROMPT_SAFETY_BUFFER,
        estimatedImageTokens: DEFAULT_ESTIMATED_IMAGE_TOKENS,
        modelRules: [
            {
                id: "anthropic-claude-family",
                match: /\b(claude|sonnet|opus|haiku)\b/i,
                contextWindow: 200_000,
                supportsVision: true,
                notes: "Claude family",
            },
        ],
    },
    chutes: {
        providerId: "chutes",
        defaultContextWindow: 32_768,
        defaultTemperature: DEFAULT_TEMPERATURE,
        defaultOutputTokens: {
            "step-description": DEFAULT_STEP_OUTPUT_TOKENS,
            title: DEFAULT_TITLE_OUTPUT_TOKENS,
        },
        promptSafetyBuffer: DEFAULT_PROMPT_SAFETY_BUFFER,
        estimatedImageTokens: DEFAULT_ESTIMATED_IMAGE_TOKENS,
        modelRules: [
            ...REASONING_RULES,
            {
                id: "chutes-vision-family",
                match: /\b(llama-3\.2-11b-vision|vision-instruct|pixtral)\b/i,
                contextWindow: 32_768,
                supportsVision: true,
                notes: "Vision-capable Chutes family",
            },
        ],
    },
    ollama: {
        providerId: "ollama",
        defaultContextWindow: 16_384,
        defaultTemperature: DEFAULT_TEMPERATURE,
        defaultOutputTokens: {
            "step-description": DEFAULT_STEP_OUTPUT_TOKENS,
            title: DEFAULT_TITLE_OUTPUT_TOKENS,
        },
        promptSafetyBuffer: DEFAULT_PROMPT_SAFETY_BUFFER,
        estimatedImageTokens: DEFAULT_ESTIMATED_IMAGE_TOKENS,
        modelRules: [
            ...REASONING_RULES,
            {
                id: "ollama-vision-family",
                match: /\b(llava|bakllava|vision|moondream|minicpm-v)\b/i,
                contextWindow: 16_384,
                supportsVision: true,
                notes: "Common local vision models",
            },
        ],
    },
    lmstudio: {
        providerId: "lmstudio",
        defaultContextWindow: 16_384,
        defaultTemperature: DEFAULT_TEMPERATURE,
        defaultOutputTokens: {
            "step-description": DEFAULT_STEP_OUTPUT_TOKENS,
            title: DEFAULT_TITLE_OUTPUT_TOKENS,
        },
        promptSafetyBuffer: DEFAULT_PROMPT_SAFETY_BUFFER,
        estimatedImageTokens: DEFAULT_ESTIMATED_IMAGE_TOKENS,
        modelRules: [
            ...REASONING_RULES,
            {
                id: "lmstudio-vision-family",
                match: /\b(llava|vision|moondream|minicpm-v|pixtral)\b/i,
                contextWindow: 16_384,
                supportsVision: true,
                notes: "Common LM Studio vision models",
            },
        ],
    },
    custom: {
        providerId: "custom",
        defaultContextWindow: 16_384,
        defaultTemperature: DEFAULT_TEMPERATURE,
        defaultOutputTokens: {
            "step-description": DEFAULT_STEP_OUTPUT_TOKENS,
            title: DEFAULT_TITLE_OUTPUT_TOKENS,
        },
        promptSafetyBuffer: DEFAULT_PROMPT_SAFETY_BUFFER,
        estimatedImageTokens: DEFAULT_ESTIMATED_IMAGE_TOKENS,
        modelRules: [...REASONING_RULES],
    },
};

const DEFAULT_ADVANCED_SETTINGS: AdvancedAiSettings = {
    useProviderDefaults: true,
    temperatureOverride: null,
    outputTokenLimitOverride: null,
    contextWindowOverride: null,
};

function getProviderCapability(providerId: AIProviderId): ProviderCapability {
    return CAPABILITY_REGISTRY[providerId] ?? CAPABILITY_REGISTRY.custom;
}

function findMatchingRule(providerId: AIProviderId, model: string): ModelCapabilityRule | null {
    const providerCapability = getProviderCapability(providerId);
    const normalizedModel = model.trim();
    if (!normalizedModel) {
        return null;
    }

    for (const rule of providerCapability.modelRules) {
        if (rule.match.test(normalizedModel)) {
            return rule;
        }
    }

    if (providerId !== "custom") {
        for (const rule of CAPABILITY_REGISTRY.custom.modelRules) {
            if (rule.match.test(normalizedModel)) {
                return rule;
            }
        }
    }

    return null;
}

export function getDefaultAdvancedAiSettings(): AdvancedAiSettings {
    return { ...DEFAULT_ADVANCED_SETTINGS };
}

export function resolveModelPolicy(input: ResolveModelPolicyInput): ResolvedModelPolicy {
    const providerCapability = getProviderCapability(input.providerId);
    const normalizedModel = input.model.trim();
    const modelRule = findMatchingRule(input.providerId, normalizedModel);
    const effectiveSettings = {
        ...DEFAULT_ADVANCED_SETTINGS,
        ...input.settings,
    };

    const usedManualContextWindow =
        !effectiveSettings.useProviderDefaults &&
        typeof effectiveSettings.contextWindowOverride === "number" &&
        effectiveSettings.contextWindowOverride > 0;
    const usedManualOutputLimit =
        !effectiveSettings.useProviderDefaults &&
        typeof effectiveSettings.outputTokenLimitOverride === "number" &&
        effectiveSettings.outputTokenLimitOverride > 0;
    const usedManualTemperature =
        !effectiveSettings.useProviderDefaults &&
        typeof effectiveSettings.temperatureOverride === "number";

    const baseContextWindow = usedManualContextWindow
        ? Math.round(effectiveSettings.contextWindowOverride!)
        : modelRule?.contextWindow ?? providerCapability.defaultContextWindow;

    const baseOutputLimit = usedManualOutputLimit
        ? Math.round(effectiveSettings.outputTokenLimitOverride!)
        : modelRule?.maxOutputTokens?.[input.purpose] ??
            providerCapability.defaultOutputTokens[input.purpose];

    const omitTemperature = modelRule?.omitTemperature ?? false;
    const baseTemperature = usedManualTemperature
        ? effectiveSettings.temperatureOverride!
        : modelRule?.temperature ?? providerCapability.defaultTemperature;

    const contextWindow = Math.max(1_024, baseContextWindow);
    const maxOutputTokens = Math.max(16, Math.min(baseOutputLimit, contextWindow - 256));
    const promptSafetyBuffer = Math.max(256, providerCapability.promptSafetyBuffer);
    const reservedOutputTokens = Math.max(maxOutputTokens, 64);
    const promptTokenBudget = Math.max(
        MINIMUM_PROMPT_BUDGET,
        contextWindow - reservedOutputTokens - promptSafetyBuffer
    );

    const notes = [
        `Provider default context window: ${providerCapability.defaultContextWindow.toLocaleString()} tokens`,
        `Estimated image token reserve: ${providerCapability.estimatedImageTokens.toLocaleString()} tokens`,
    ];

    if (modelRule?.notes) {
        notes.push(modelRule.notes);
    }
    if (usedManualContextWindow) {
        notes.push("Manual context window override applied");
    }
    if (usedManualOutputLimit) {
        notes.push("Manual output token override applied");
    }
    if (usedManualTemperature) {
        notes.push("Manual temperature override applied");
    }
    if (omitTemperature) {
        notes.push("Temperature omitted for reasoning-compatible model family");
    }
    if (!normalizedModel) {
        notes.push("No model selected; using provider fallback defaults");
    } else if (!modelRule) {
        notes.push("Unknown model; using conservative provider fallback defaults");
    }

    return {
        providerId: input.providerId,
        model: normalizedModel,
        purpose: input.purpose,
        contextWindow,
        maxOutputTokens,
        reservedOutputTokens,
        promptTokenBudget,
        temperature: omitTemperature ? null : clampTemperature(baseTemperature),
        supportsVision: modelRule?.supportsVision ?? input.supportsVision,
        reasoningModel: modelRule?.reasoningModel ?? false,
        matchedRuleId: modelRule?.id ?? null,
        promptSafetyBuffer,
        estimatedImageTokens: providerCapability.estimatedImageTokens,
        usedManualTemperature,
        usedManualOutputLimit,
        usedManualContextWindow,
        notes,
    };
}

function clampTemperature(value: number): number {
    return Math.max(0, Math.min(2, Number.isFinite(value) ? value : DEFAULT_TEMPERATURE));
}

export function estimateTokenCount(text: string): number {
    if (!text.trim()) {
        return 0;
    }

    return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export function fitContextEntriesToBudget(input: FitContextEntriesInput): ContextBudgetResult {
    const buildEstimate = (entries: string[]) => estimatePromptTokens(
        [...input.fixedTextParts, input.buildPromptText(entries)],
        input.includeImage,
        input.policy
    );

    let retainedEntries = input.contextEntries.slice();
    let estimatedPromptTokens = buildEstimate(retainedEntries);
    let droppedEntries = 0;

    while (retainedEntries.length > 0 && estimatedPromptTokens > input.policy.promptTokenBudget) {
        retainedEntries = retainedEntries.slice(1);
        droppedEntries += 1;
        estimatedPromptTokens = buildEstimate(retainedEntries);
    }

    if (estimatedPromptTokens > input.policy.promptTokenBudget) {
        throw createContextBudgetError(input.policy, estimatedPromptTokens);
    }

    return {
        retainedEntries,
        droppedEntries,
        estimatedPromptTokens,
    };
}

function estimatePromptTokens(
    textParts: string[],
    includeImage: boolean,
    policy: ResolvedModelPolicy
): number {
    const textTokens = textParts.reduce((total, part) => total + estimateTokenCount(part), 0);
    const imageTokens = includeImage ? policy.estimatedImageTokens : 0;
    return textTokens + imageTokens + BASE_MESSAGE_OVERHEAD_TOKENS;
}

function createContextBudgetError(
    policy: ResolvedModelPolicy,
    estimatedPromptTokens: number
): Error {
    return new Error(
        `Estimated prompt exceeds the configured context window for ${policy.model || policy.providerId}. ` +
        `${formatPolicySummary(policy)} Estimated prompt tokens: ${estimatedPromptTokens.toLocaleString()}.`
    );
}

export function formatPolicySummary(policy: ResolvedModelPolicy): string {
    const temperature = policy.temperature === null
        ? "omitted"
        : policy.temperature.toFixed(2).replace(/\.00$/, "");

    return [
        `provider=${policy.providerId}`,
        `model=${policy.model || "fallback"}`,
        `purpose=${policy.purpose}`,
        `context=${policy.contextWindow.toLocaleString()}`,
        `promptBudget=${policy.promptTokenBudget.toLocaleString()}`,
        `output=${policy.maxOutputTokens.toLocaleString()}`,
        `temperature=${temperature}`,
        `vision=${policy.supportsVision ? "yes" : "no"}`,
        `reasoning=${policy.reasoningModel ? "yes" : "no"}`,
    ].join(", ");
}

export function buildChatCompletionBody(
    policy: ResolvedModelPolicy,
    model: string,
    messages: Array<Record<string, unknown>>
): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: policy.maxOutputTokens,
    };

    if (policy.temperature !== null) {
        body.temperature = policy.temperature;
    }

    return body;
}

export function withPolicyDiagnostics(error: unknown, policy: ResolvedModelPolicy): Error {
    const message = error instanceof Error ? error.message : String(error);
    const diagnosticMessage = formatPolicySummary(policy);

    if (isLikelyContextLimitError(message)) {
        return new Error(
            `The provider rejected the request due to context or token limits. ${diagnosticMessage}. ` +
            `Provider message: ${message}`
        );
    }

    return new Error(`${message} [${diagnosticMessage}]`);
}

function isLikelyContextLimitError(message: string): boolean {
    return /(context|token|prompt).*(limit|length|too long|exceed)|context_length_exceeded|max.*token/i.test(message);
}
