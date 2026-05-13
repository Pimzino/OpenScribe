import { ReactNode } from "react";

interface PageShellProps {
    /** Left side of the sticky header: back button, title, subtitle. */
    leading?: ReactNode;
    /** Right side of the sticky header: action buttons. */
    actions?: ReactNode;
    /** Optional sticky row below the header (tabs, search, banner). */
    toolbar?: ReactNode;
    /** Scrollable body content. */
    children: ReactNode;
    /** Disable the default body padding when children manage their own spacing. */
    bodyPadding?: boolean;
    /** Constrain header + body width (e.g. "max-w-3xl"). Defaults to full width. */
    maxWidth?: string;
}

export default function PageShell({
    leading,
    actions,
    toolbar,
    children,
    bodyPadding = true,
    maxWidth,
}: PageShellProps) {
    const widthClass = maxWidth ? `${maxWidth} mx-auto` : "";
    const bodyPaddingClass = bodyPadding ? "px-4 sm:px-6 lg:px-8 py-5 sm:py-6" : "";

    return (
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <header
                className="glass-surface-1 z-20 flex-shrink-0 border-b border-white/8"
                style={{ borderTop: "none" }}
            >
                <div className={`${widthClass} px-4 py-3 sm:px-6 sm:py-3.5 lg:px-8`}>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        {leading && (
                            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                                {leading}
                            </div>
                        )}
                        {actions && (
                            <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                                {actions}
                            </div>
                        )}
                    </div>
                    {toolbar && <div className="mt-3">{toolbar}</div>}
                </div>
            </header>
            <div className="scroll-container flex-1 overflow-y-auto overflow-x-hidden">
                <div className={`${widthClass} ${bodyPaddingClass}`}>{children}</div>
            </div>
        </main>
    );
}
