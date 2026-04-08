import { Bell } from "lucide-react";
import { useNotificationStore } from "../../store/notificationStore";

export default function NotificationBell() {
    const unreadCount = useNotificationStore((s) => s.unreadCount);
    const toggleTray = useNotificationStore((s) => s.toggleTray);

    return (
        <button
            onClick={toggleTray}
            className="relative p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors"
            aria-label="Notifications"
        >
            <Bell size={18} />
            {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
                    {unreadCount > 9 ? "9+" : unreadCount}
                </span>
            )}
        </button>
    );
}
