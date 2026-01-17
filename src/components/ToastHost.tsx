import { useToastStore, type ToastVariant } from "../store/toastStore";

function getVariantAccentColor(variant: ToastVariant): string {
  if (variant === "success") return "#22c55e";
  if (variant === "error") return "#ef4444";
  return "#49B8D3";
}

export default function ToastHost() {
  const { toasts, dismissToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 items-end">
      {toasts.map((toast) => {
        const accentColor = getVariantAccentColor(toast.variant);

        return (
          <div
            key={toast.id}
            onClick={() => dismissToast(toast.id)}
            className="glass-surface-2 rounded-xl shadow-xl border border-white/10 text-white w-80 max-w-[calc(100vw-3rem)] cursor-pointer hover:bg-white/5 transition-colors"
            style={{ borderLeft: `4px solid ${accentColor}` }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-start gap-3 p-4">
              <div
                className="mt-1.5 w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: accentColor }}
              />

              <div className="flex-1 text-sm text-white/90 leading-snug">{toast.message}</div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissToast(toast.id);
                }}
                className="-mt-1 -mr-1 p-1 text-white/60 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                aria-label="Dismiss toast"
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
