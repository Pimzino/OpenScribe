import { useState } from "react";
import { X, Check, ChevronDown, ChevronUp } from "lucide-react";
import { useNotificationStore, type Notification, type NotificationVariant } from "../../store/notificationStore";
import Tooltip from "../Tooltip";
import { formatRelativeTime } from "../../lib/relativeTime";

function getVariantAccentColor(variant: NotificationVariant): string {
    if (variant === "success") return "#22c55e";
    if (variant === "error") return "#ef4444";
    return "#49B8D3";
}

interface NotificationCardProps {
    notification: Notification;
}

export default function NotificationCard({ notification }: NotificationCardProps) {
    const [expanded, setExpanded] = useState(false);
    const markAsRead = useNotificationStore((s) => s.markAsRead);
    const deleteNotification = useNotificationStore((s) => s.deleteNotification);

    const accentColor = getVariantAccentColor(notification.variant);
    const isLong = notification.message.length > 100;

    const handleClick = () => {
        if (!notification.is_read) {
            markAsRead(notification.id);
        }
        if (isLong) {
            setExpanded((prev) => !prev);
        }
    };

    return (
        <div
            onClick={handleClick}
            className={`group glass-surface-2 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors ${
                !notification.is_read ? "bg-white/[0.03]" : ""
            }`}
            style={{ borderLeft: `4px solid ${accentColor}` }}
        >
            <div className="flex items-start gap-3 p-3">
                {/* Unread dot */}
                <div
                    className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 transition-opacity ${
                        notification.is_read ? "opacity-0" : "opacity-100"
                    }`}
                    style={{ backgroundColor: accentColor }}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                    {notification.title && (
                        <div className="text-sm font-medium text-white mb-0.5 truncate">
                            {notification.title}
                        </div>
                    )}
                    <div
                        className={`text-sm text-white/80 leading-snug break-words ${
                            !expanded && isLong ? "line-clamp-2" : ""
                        }`}
                    >
                        {notification.message}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[11px] text-white/40">
                            {formatRelativeTime(notification.created_at)}
                        </span>
                        {isLong && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setExpanded((prev) => !prev);
                                }}
                                className="text-white/40 hover:text-white/70 transition-colors"
                            >
                                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    {!notification.is_read && (
                        <Tooltip content="Mark as read">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    markAsRead(notification.id);
                                }}
                                className="p-1 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                                aria-label="Mark as read"
                            >
                                <Check size={14} />
                            </button>
                        </Tooltip>
                    )}
                    <Tooltip content="Delete">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                deleteNotification(notification.id);
                            }}
                            className="p-1 text-white/40 hover:text-red-400 hover:bg-white/10 rounded-md transition-colors"
                            aria-label="Delete notification"
                        >
                            <X size={14} />
                        </button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}
