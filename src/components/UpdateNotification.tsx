import { Download, X, RefreshCw, AlertCircle } from 'lucide-react';
import { useUpdateStore } from '../store/updateStore';

export default function UpdateNotification() {
    const {
        updateAvailable,
        updateInfo,
        downloadProgress,
        isDownloading,
        isInstalling,
        error,
        dismissed,
        downloadAndInstall,
        dismissUpdate,
    } = useUpdateStore();

    // Don't show if no update, dismissed, or installing (app will restart)
    if (!updateAvailable || dismissed || isInstalling) {
        return null;
    }

    return (
        <div className="fixed bottom-6 left-6 z-[9998] w-80">
            <div
                className="glass-surface-2 rounded-xl shadow-xl border border-white/10 text-white overflow-hidden"
                style={{ borderLeft: '4px solid #49B8D3' }}
            >
                <div className="p-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                            <Download size={18} className="text-[#49B8D3]" />
                            <span className="font-medium">Update Available</span>
                        </div>
                        {!isDownloading && (
                            <button
                                onClick={dismissUpdate}
                                className="p-1 text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                                aria-label="Dismiss"
                            >
                                <X size={14} />
                            </button>
                        )}
                    </div>

                    {/* Version info */}
                    {updateInfo && (
                        <p className="text-sm text-white/70 mb-3">
                            Version {updateInfo.version} is ready to install.
                        </p>
                    )}

                    {/* Error state */}
                    {error && (
                        <div className="flex items-start gap-2 text-sm text-red-400 mb-3">
                            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Download progress */}
                    {isDownloading && (
                        <div className="mb-3">
                            <div className="flex items-center justify-between text-sm text-white/70 mb-1">
                                <span>Downloading...</span>
                                <span>{downloadProgress}%</span>
                            </div>
                            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-[#49B8D3] transition-all duration-300"
                                    style={{ width: `${downloadProgress}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={downloadAndInstall}
                            disabled={isDownloading}
                            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-[#49B8D3] hover:bg-[#3da8c3] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
                        >
                            {isDownloading ? (
                                <>
                                    <RefreshCw size={14} className="animate-spin" />
                                    <span>Downloading</span>
                                </>
                            ) : (
                                <>
                                    <Download size={14} />
                                    <span>Update Now</span>
                                </>
                            )}
                        </button>
                        {!isDownloading && (
                            <button
                                onClick={dismissUpdate}
                                className="px-3 py-2 text-white/70 hover:text-white hover:bg-white/10 text-sm rounded-lg transition-colors"
                            >
                                Later
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
