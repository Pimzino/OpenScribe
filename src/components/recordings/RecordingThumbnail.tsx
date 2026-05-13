import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { resolveDisplayImageSrc } from "../../lib/localAssets";

interface RecordingThumbnailProps {
    /** Recording id — used to seed the gradient fallback so empty rows stay stable. */
    id: string;
    /** Absolute path to the first step's screenshot, if any. */
    screenshotPath?: string | null;
    /** Tailwind class applied to the outer wrapper. Defaults to a 16/10 tile. */
    className?: string;
}

const FALLBACK_GRADIENTS = [
    "from-[#2721E8]/40 via-[#2721E8]/15 to-[#49B8D3]/25",
    "from-[#49B8D3]/35 via-[#49B8D3]/10 to-[#2721E8]/25",
    "from-[#FF6B35]/35 via-[#FF6B35]/10 to-[#2721E8]/25",
    "from-[#2721E8]/35 via-[#FF6B35]/15 to-[#49B8D3]/25",
];

function hashIndex(id: string, mod: number): number {
    let h = 0;
    for (let i = 0; i < id.length; i++) {
        h = (h * 31 + id.charCodeAt(i)) >>> 0;
    }
    return h % mod;
}

export default function RecordingThumbnail({
    id,
    screenshotPath,
    className = "aspect-[16/10] w-[120px]",
}: RecordingThumbnailProps) {
    const [src, setSrc] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setFailed(false);
        setSrc(null);
        if (!screenshotPath) return;
        resolveDisplayImageSrc(screenshotPath)
            .then((resolved) => {
                if (!cancelled) setSrc(resolved || null);
            })
            .catch(() => {
                if (!cancelled) setFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [screenshotPath]);

    const showImage = !!screenshotPath && !!src && !failed;
    const gradient = FALLBACK_GRADIENTS[hashIndex(id, FALLBACK_GRADIENTS.length)];

    return (
        <div
            className={`relative flex-shrink-0 overflow-hidden rounded-lg ring-1 ring-white/10 ${className}`}
        >
            {showImage ? (
                <img
                    src={src!}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    onError={() => setFailed(true)}
                    className="h-full w-full object-cover"
                />
            ) : (
                <div
                    className={`h-full w-full bg-gradient-to-br ${gradient} flex items-center justify-center`}
                >
                    <FileText size={20} className="text-white/40" />
                </div>
            )}
            <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-white/5" />
        </div>
    );
}
