import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'error';

export interface Toast {
    id: string;
    message: string;
    variant: ToastVariant;
    durationMs?: number;
    createdAt: number;
}

interface ShowToastInput {
    message: string;
    variant: ToastVariant;
    durationMs?: number;
}

interface ToastState {
    toasts: Toast[];
    showToast: (input: ShowToastInput) => string;
    dismissToast: (id: string) => void;
    clearToasts: () => void;
    updateToast?: (id: string, patch: Partial<Omit<Toast, 'id' | 'createdAt'>>) => void;
}

const DEFAULT_DURATION_MS = 2800;

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

function generateToastId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return crypto.randomUUID();
    }

    return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export const useToastStore = create<ToastState>((set) => ({
    toasts: [],

    showToast: ({ message, variant, durationMs }) => {
        const id = generateToastId();
        const finalDurationMs = durationMs ?? DEFAULT_DURATION_MS;
        const createdAt = Date.now();

        set((state) => ({
            toasts: [...state.toasts, { id, message, variant, durationMs: finalDurationMs, createdAt }],
        }));

        const timeoutId = setTimeout(() => {
            useToastStore.getState().dismissToast(id);
        }, finalDurationMs);
        toastTimeouts.set(id, timeoutId);

        return id;
    },

    dismissToast: (id) => {
        const timeoutId = toastTimeouts.get(id);
        if (timeoutId) {
            clearTimeout(timeoutId);
            toastTimeouts.delete(id);
        }

        set((state) => ({
            toasts: state.toasts.filter((toast) => toast.id !== id),
        }));
    },

    clearToasts: () => {
        toastTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
        toastTimeouts.clear();
        set({ toasts: [] });
    },

    updateToast: (id, patch) => {
        if (patch.durationMs !== undefined) {
            const timeoutId = toastTimeouts.get(id);
            if (timeoutId) {
                clearTimeout(timeoutId);
                toastTimeouts.delete(id);
            }

            const finalDurationMs = patch.durationMs ?? DEFAULT_DURATION_MS;
            const newTimeoutId = setTimeout(() => {
                useToastStore.getState().dismissToast(id);
            }, finalDurationMs);
            toastTimeouts.set(id, newTimeoutId);
        }

        set((state) => ({
            toasts: state.toasts.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast)),
        }));
    },
}));
