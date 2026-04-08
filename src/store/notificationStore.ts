import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type NotificationVariant = 'info' | 'success' | 'error';

export interface Notification {
    id: string;
    title: string | null;
    message: string;
    variant: NotificationVariant;
    is_read: boolean;
    created_at: number;
}

interface NotificationState {
    notifications: Notification[];
    unreadCount: number;
    loading: boolean;
    trayOpen: boolean;

    fetchNotifications: () => Promise<void>;
    fetchUnreadCount: () => Promise<void>;
    addNotification: (input: { title?: string; message: string; variant: NotificationVariant }) => Promise<Notification | null>;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    deleteNotification: (id: string) => Promise<void>;
    clearAll: () => Promise<void>;
    setTrayOpen: (open: boolean) => void;
    toggleTray: () => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
    notifications: [],
    unreadCount: 0,
    loading: false,
    trayOpen: false,

    fetchNotifications: async () => {
        set({ loading: true });
        try {
            const notifications = await invoke<Notification[]>('list_notifications', {
                limit: 50,
                offset: 0,
            });
            set({ notifications, loading: false });
        } catch (err) {
            console.error('Failed to fetch notifications:', err);
            set({ loading: false });
        }
    },

    fetchUnreadCount: async () => {
        try {
            const count = await invoke<number>('get_unread_notification_count');
            set({ unreadCount: count });
        } catch (err) {
            console.error('Failed to fetch unread count:', err);
        }
    },

    addNotification: async (input) => {
        try {
            const notification = await invoke<Notification>('create_notification', {
                title: input.title ?? null,
                message: input.message,
                variant: input.variant,
            });
            set((state) => ({
                notifications: [notification, ...state.notifications],
                unreadCount: state.unreadCount + 1,
            }));
            return notification;
        } catch (err) {
            console.error('Failed to create notification:', err);
            return null;
        }
    },

    markAsRead: async (id) => {
        const notification = get().notifications.find((n) => n.id === id);
        if (!notification || notification.is_read) return;

        set((state) => ({
            notifications: state.notifications.map((n) =>
                n.id === id ? { ...n, is_read: true } : n
            ),
            unreadCount: Math.max(0, state.unreadCount - 1),
        }));

        try {
            await invoke('mark_notification_read', { id });
        } catch (err) {
            console.error('Failed to mark notification read:', err);
        }
    },

    markAllAsRead: async () => {
        set((state) => ({
            notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
            unreadCount: 0,
        }));

        try {
            await invoke('mark_all_notifications_read');
        } catch (err) {
            console.error('Failed to mark all notifications read:', err);
        }
    },

    deleteNotification: async (id) => {
        const notification = get().notifications.find((n) => n.id === id);
        const wasUnread = notification && !notification.is_read;

        set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id),
            unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
        }));

        try {
            await invoke('delete_notification', { id });
        } catch (err) {
            console.error('Failed to delete notification:', err);
        }
    },

    clearAll: async () => {
        set({ notifications: [], unreadCount: 0 });

        try {
            await invoke('clear_all_notifications');
        } catch (err) {
            console.error('Failed to clear all notifications:', err);
        }
    },

    setTrayOpen: (open) => {
        set({ trayOpen: open });
        if (open) {
            get().fetchNotifications();
        }
    },

    toggleTray: () => {
        const wasOpen = get().trayOpen;
        set({ trayOpen: !wasOpen });
        if (!wasOpen) {
            get().fetchNotifications();
        }
    },
}));
