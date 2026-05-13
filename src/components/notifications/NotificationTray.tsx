import { useEffect, useRef } from "react";
import { Check, Trash2, BellOff, X } from "lucide-react";
import { useNotificationStore } from "../../store/notificationStore";
import NotificationCard from "./NotificationCard";
import Tooltip from "../Tooltip";

export default function NotificationTray() {
    const trayOpen = useNotificationStore((s) => s.trayOpen);
    const setTrayOpen = useNotificationStore((s) => s.setTrayOpen);
    const notifications = useNotificationStore((s) => s.notifications);
    const unreadCount = useNotificationStore((s) => s.unreadCount);
    const loading = useNotificationStore((s) => s.loading);
    const markAllAsRead = useNotificationStore((s) => s.markAllAsRead);
    const clearAll = useNotificationStore((s) => s.clearAll);
    const panelRef = useRef<HTMLDivElement>(null);

    // Close on Escape
    useEffect(() => {
        if (!trayOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setTrayOpen(false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [trayOpen, setTrayOpen]);

    if (!trayOpen) return null;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 z-[9990]"
                onClick={() => setTrayOpen(false)}
            />

            {/* Panel */}
            <div
                ref={panelRef}
                className="glass-surface-2 animate-tray-slide-in fixed bottom-3 right-3 top-12 z-[9991] flex w-[min(380px,calc(100vw-1.5rem))] flex-col rounded-xl border border-white/10 shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-white/8">
                    <h2 className="text-base font-semibold text-white">
                        Notifications
                        {unreadCount > 0 && (
                            <span className="ml-2 text-xs font-normal text-white/50">
                                {unreadCount} unread
                            </span>
                        )}
                    </h2>
                    <div className="flex items-center gap-1">
                        {unreadCount > 0 && (
                            <Tooltip content="Mark all as read">
                                <button
                                    onClick={markAllAsRead}
                                    className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                                >
                                    <Check size={16} />
                                </button>
                            </Tooltip>
                        )}
                        {notifications.length > 0 && (
                            <Tooltip content="Clear all">
                                <button
                                    onClick={clearAll}
                                    className="p-1.5 text-white/50 hover:text-red-400 hover:bg-white/10 rounded-md transition-colors"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </Tooltip>
                        )}
                        <Tooltip content="Close">
                            <button
                                onClick={() => setTrayOpen(false)}
                                aria-label="Close notifications"
                                className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </Tooltip>
                    </div>
                </div>

                {/* Notification list */}
                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {loading && notifications.length === 0 ? (
                        <div className="flex items-center justify-center py-12">
                            <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                        </div>
                    ) : notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-12 text-white/30">
                            <BellOff size={32} className="mb-3" />
                            <p className="text-sm">No notifications yet</p>
                        </div>
                    ) : (
                        notifications.map((notification) => (
                            <NotificationCard
                                key={notification.id}
                                notification={notification}
                            />
                        ))
                    )}
                </div>
            </div>
        </>
    );
}
