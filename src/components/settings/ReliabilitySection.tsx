import { useSettingsStore } from "../../store/settingsStore";

export default function ReliabilitySection() {
    const {
        enableAutoRetry,
        maxRetryAttempts,
        initialRetryDelayMs,
        enableRequestThrottling,
        throttleDelayMs,
        setEnableAutoRetry,
        setMaxRetryAttempts,
        setInitialRetryDelayMs,
        setEnableRequestThrottling,
        setThrottleDelayMs,
    } = useSettingsStore();

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-white mb-1">Reliability</h3>
                <p className="text-xs text-white/50">Configure how the app handles API rate limits during documentation generation.</p>
            </div>

            <div>
                <div className="flex items-center justify-between mb-4">
                    <div className="pr-4">
                        <label className="block text-sm font-medium text-white/80">
                            Auto-Retry on Rate Limit
                        </label>
                        <p className="text-xs text-white/50 mt-1">
                            Automatically retry requests when rate limited (HTTP 429)
                        </p>
                    </div>
                    <button
                        aria-label={`Auto-retry on rate limit: ${enableAutoRetry ? 'enabled' : 'disabled'}`}
                        onClick={() => setEnableAutoRetry(!enableAutoRetry)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                            enableAutoRetry ? 'bg-[#2721E8]' : 'bg-white/20'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enableAutoRetry ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                {enableAutoRetry && (
                    <div className="ml-4 space-y-4 mb-6 p-4 bg-white/5 rounded-lg">
                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">
                                Max Retry Attempts
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="1"
                                    max="10"
                                    value={maxRetryAttempts}
                                    onChange={(e) => setMaxRetryAttempts(parseInt(e.target.value))}
                                    aria-label="Max retry attempts"
                                    className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#2721E8]"
                                />
                                <span className="text-sm text-white/80 w-8 text-center">{maxRetryAttempts}</span>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-white/60 mb-2">
                                Initial Retry Delay
                            </label>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="100"
                                    max="5000"
                                    step="100"
                                    value={initialRetryDelayMs}
                                    onChange={(e) => setInitialRetryDelayMs(parseInt(e.target.value))}
                                    aria-label="Initial retry delay in milliseconds"
                                    className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#2721E8]"
                                />
                                <span className="text-sm text-white/80 w-16 text-right">{initialRetryDelayMs}ms</span>
                            </div>
                            <p className="text-xs text-white/40 mt-1">
                                Delay doubles with each retry (exponential backoff)
                            </p>
                        </div>
                    </div>
                )}

                <div className="flex items-center justify-between mb-4">
                    <div className="pr-4">
                        <label className="block text-sm font-medium text-white/80">
                            Request Throttling
                        </label>
                        <p className="text-xs text-white/50 mt-1">
                            Add delay between API calls to prevent hitting rate limits
                        </p>
                    </div>
                    <button
                        aria-label={`Request throttling: ${enableRequestThrottling ? 'enabled' : 'disabled'}`}
                        onClick={() => setEnableRequestThrottling(!enableRequestThrottling)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                            enableRequestThrottling ? 'bg-[#2721E8]' : 'bg-white/20'
                        }`}
                    >
                        <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                enableRequestThrottling ? 'translate-x-6' : 'translate-x-1'
                            }`}
                        />
                    </button>
                </div>

                {enableRequestThrottling && (
                    <div className="ml-4 p-4 bg-white/5 rounded-lg">
                        <label className="block text-sm font-medium text-white/60 mb-2">
                            Delay Between Requests
                        </label>
                        <div className="flex items-center gap-4">
                            <input
                                type="range"
                                min="0"
                                max="5000"
                                step="100"
                                value={throttleDelayMs}
                                onChange={(e) => setThrottleDelayMs(parseInt(e.target.value))}
                                aria-label="Delay between requests in milliseconds"
                                className="flex-1 h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-[#2721E8]"
                            />
                            <span className="text-sm text-white/80 w-16 text-right">{throttleDelayMs}ms</span>
                        </div>
                        <p className="text-xs text-white/40 mt-1">
                            {throttleDelayMs === 0 ? 'No delay between requests' :
                             `Adds ${(throttleDelayMs / 1000).toFixed(1)}s between each API call`}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
