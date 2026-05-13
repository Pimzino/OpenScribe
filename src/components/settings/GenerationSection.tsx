import { RotateCcw } from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";
import {
    TONE_OPTIONS,
    AUDIENCE_OPTIONS,
    VERBOSITY_OPTIONS,
    BRAND_VOICE_OPTIONS,
} from "../../lib/promptConstants";

export default function GenerationSection() {
    const {
        writingStyle,
        enableStateDiff,
        enableCoherencePass,
        enableMultiStagePrompting,
        afterFrameMaxWaitMs,
        enableVideoClips,
        setWritingStyleTone,
        setWritingStyleAudience,
        setWritingStyleVerbosity,
        setWritingStyleBrandVoice,
        resetWritingStyle,
        setEnableStateDiff,
        setEnableCoherencePass,
        setEnableMultiStagePrompting,
        setAfterFrameMaxWaitMs,
        setEnableVideoClips,
    } = useSettingsStore();

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-white mb-1">Generation</h3>
                <p className="text-xs text-white/50">Control which AI passes run and how the resulting documentation reads.</p>
            </div>

            {/* Pipeline toggles */}
            <div>
                <h4 className="text-sm font-medium text-white/80 mb-2">
                    Pipeline
                </h4>
                <p className="text-xs text-white/50 mb-4">
                    Each enabled pass adds one or more LLM calls per recording.
                </p>

                <div className="flex items-center justify-between mb-4">
                    <div className="pr-4">
                        <label className="block text-sm font-medium text-white/80">
                            State diff (after-frames)
                        </label>
                        <p className="text-xs text-white/50 mt-1">
                            Capture a second screenshot ~700ms after each click/type and send both frames to the AI so it can describe the outcome. Roughly doubles vision tokens per step.
                        </p>
                    </div>
                    <button
                        aria-label={`State diff: ${enableStateDiff ? 'enabled' : 'disabled'}`}
                        onClick={() => setEnableStateDiff(!enableStateDiff)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                            enableStateDiff ? 'bg-[#2721E8]' : 'bg-white/20'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enableStateDiff ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <div className="flex items-center justify-between mb-4">
                    <div className="pr-4">
                        <label className="block text-sm font-medium text-white/80">
                            Coherence pass
                        </label>
                        <p className="text-xs text-white/50 mt-1">
                            After all steps are generated, run one final LLM call to rewrite them as a connected guide with natural transitions. Adds one LLM call per recording.
                        </p>
                    </div>
                    <button
                        aria-label={`Coherence pass: ${enableCoherencePass ? 'enabled' : 'disabled'}`}
                        onClick={() => setEnableCoherencePass(!enableCoherencePass)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                            enableCoherencePass ? 'bg-[#2721E8]' : 'bg-white/20'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enableCoherencePass ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <div className="flex items-center justify-between mb-4">
                    <div className="pr-4">
                        <label className="block text-sm font-medium text-white/80">
                            Multi-stage prompting (experimental)
                        </label>
                        <p className="text-xs text-white/50 mt-1">
                            Split each step into a vision identification call + a text-only writing call. Slower and costlier but typically more accurate when element metadata is sparse.
                        </p>
                    </div>
                    <button
                        aria-label={`Multi-stage prompting: ${enableMultiStagePrompting ? 'enabled' : 'disabled'}`}
                        onClick={() => setEnableMultiStagePrompting(!enableMultiStagePrompting)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                            enableMultiStagePrompting ? 'bg-[#2721E8]' : 'bg-white/20'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enableMultiStagePrompting ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                <div className="flex items-center justify-between mb-4">
                    <div className="pr-4">
                        <label className="block text-sm font-medium text-white/80">
                            Capture short video clips (experimental)
                        </label>
                        <p className="text-xs text-white/50 mt-1">
                            Keep a continuous frame buffer during recording and save a short animated clip around each event. Adds ~10-15 MB per recording and modest CPU overhead.
                        </p>
                    </div>
                    <button
                        aria-label={`Video clips: ${enableVideoClips ? 'enabled' : 'disabled'}`}
                        onClick={() => setEnableVideoClips(!enableVideoClips)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                            enableVideoClips ? 'bg-[#2721E8]' : 'bg-white/20'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enableVideoClips ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                {enableStateDiff && (
                    <div className="mb-2">
                        <label className="block text-sm font-medium text-white/80 mb-1">
                            After-frame settling cap
                        </label>
                        <p className="text-xs text-white/50 mb-3">
                            Maximum time to wait for the UI to stabilise after an event before capturing the after-frame. Longer caps catch slower animations but increase background CPU briefly.
                        </p>
                        <div className="flex items-center gap-3">
                            <input
                                type="range"
                                min={500}
                                max={5000}
                                step={100}
                                value={afterFrameMaxWaitMs}
                                onChange={(e) => setAfterFrameMaxWaitMs(Number(e.target.value))}
                                className="flex-1"
                                aria-label="After-frame settling cap in milliseconds"
                            />
                            <span className="text-sm text-white/70 tabular-nums w-16 text-right">
                                {afterFrameMaxWaitMs} ms
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Writing Style (flattened) */}
            <div className="border-t border-white/8 pt-6">
                <div className="mb-4">
                    <h4 className="text-sm font-medium text-white/80">
                        Writing Style
                    </h4>
                    <p className="text-xs text-white/50 mt-1">
                        Customize how the AI writes step descriptions.
                    </p>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-white/60 mb-2">
                            Tone
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {TONE_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => setWritingStyleTone(option.value)}
                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                        writingStyle.tone === option.value
                                            ? 'bg-[#2721E8] text-white'
                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                    }`}
                                >
                                    <div className="font-medium">{option.label}</div>
                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-white/60 mb-2">
                            Audience
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {AUDIENCE_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => setWritingStyleAudience(option.value)}
                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                        writingStyle.audience === option.value
                                            ? 'bg-[#2721E8] text-white'
                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                    }`}
                                >
                                    <div className="font-medium">{option.label}</div>
                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-white/60 mb-2">
                            Detail Level
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {VERBOSITY_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => setWritingStyleVerbosity(option.value)}
                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                        writingStyle.verbosity === option.value
                                            ? 'bg-[#2721E8] text-white'
                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                    }`}
                                >
                                    <div className="font-medium">{option.label}</div>
                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-white/60 mb-2">
                            Brand Voice
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {BRAND_VOICE_OPTIONS.map((option) => (
                                <button
                                    key={option.value}
                                    onClick={() => setWritingStyleBrandVoice(option.value)}
                                    className={`px-3 py-2 rounded-md text-sm text-left transition-all ${
                                        writingStyle.brandVoice === option.value
                                            ? 'bg-[#2721E8] text-white'
                                            : 'bg-[#161316]/70 text-white/70 hover:bg-white/10'
                                    }`}
                                >
                                    <div className="font-medium">{option.label}</div>
                                    <div className="text-xs opacity-70 mt-0.5">{option.description}</div>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <button
                            onClick={resetWritingStyle}
                            className="text-xs text-[#49B8D3] hover:text-[#5fc5e0] transition-colors flex items-center gap-1"
                        >
                            <RotateCcw size={12} />
                            Reset to Defaults
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
