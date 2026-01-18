import { create } from 'zustand';
import { check, Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

export interface UpdateInfo {
    version: string;
    currentVersion: string;
    body?: string;
}

interface UpdateState {
    updateAvailable: boolean;
    updateInfo: UpdateInfo | null;
    downloadProgress: number;
    isDownloading: boolean;
    isInstalling: boolean;
    error: string | null;
    dismissed: boolean;
    pendingUpdate: Update | null;

    checkForUpdates: () => Promise<boolean>;
    downloadAndInstall: () => Promise<void>;
    dismissUpdate: () => void;
    reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
    updateAvailable: false,
    updateInfo: null,
    downloadProgress: 0,
    isDownloading: false,
    isInstalling: false,
    error: null,
    dismissed: false,
    pendingUpdate: null,

    checkForUpdates: async () => {
        set({ error: null });

        try {
            const update = await check();

            if (update) {
                set({
                    updateAvailable: true,
                    updateInfo: {
                        version: update.version,
                        currentVersion: update.currentVersion,
                        body: update.body ?? undefined,
                    },
                    pendingUpdate: update,
                    dismissed: false,
                });
                return true;
            } else {
                set({
                    updateAvailable: false,
                    updateInfo: null,
                    pendingUpdate: null,
                });
                return false;
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to check for updates';
            set({ error: message });
            return false;
        }
    },

    downloadAndInstall: async () => {
        const { pendingUpdate } = get();

        if (!pendingUpdate) {
            set({ error: 'No update available' });
            return;
        }

        set({ isDownloading: true, downloadProgress: 0, error: null });

        try {
            let downloaded = 0;
            let contentLength = 0;

            await pendingUpdate.downloadAndInstall((event) => {
                switch (event.event) {
                    case 'Started':
                        contentLength = event.data.contentLength ?? 0;
                        break;
                    case 'Progress':
                        downloaded += event.data.chunkLength;
                        if (contentLength > 0) {
                            const progress = Math.round((downloaded / contentLength) * 100);
                            set({ downloadProgress: progress });
                        }
                        break;
                    case 'Finished':
                        set({ downloadProgress: 100 });
                        break;
                }
            });

            set({ isDownloading: false, isInstalling: true });

            // Relaunch the application to apply the update
            await relaunch();
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to install update';
            set({
                error: message,
                isDownloading: false,
                isInstalling: false,
                downloadProgress: 0,
            });
        }
    },

    dismissUpdate: () => {
        set({ dismissed: true });
    },

    reset: () => {
        set({
            updateAvailable: false,
            updateInfo: null,
            downloadProgress: 0,
            isDownloading: false,
            isInstalling: false,
            error: null,
            dismissed: false,
            pendingUpdate: null,
        });
    },
}));
