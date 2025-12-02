import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";

interface MonitorInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}

export default function MonitorPicker() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    loadMonitors();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
      const num = parseInt(e.key);
      if (num >= 1 && num <= monitors.length) {
        handleCapture(num - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [monitors.length]);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerSize({ width: rect.width, height: rect.height });
      }
    };
    updateSize();
    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  const loadMonitors = async () => {
    try {
      const result = await invoke<MonitorInfo[]>("get_monitors");
      setMonitors(result);
    } catch (error) {
      console.error("Failed to get monitors:", error);
    }
  };

  const handleMouseEnter = async (index: number) => {
    setHoveredIndex(index);
    try {
      await invoke("show_monitor_highlight", { index });
    } catch (error) {
      console.error("Failed to show highlight:", error);
    }
  };

  const handleMouseLeave = async () => {
    setHoveredIndex(null);
    try {
      await invoke("hide_monitor_highlight");
    } catch (error) {
      console.error("Failed to hide highlight:", error);
    }
  };

  const handleCapture = async (index: number) => {
    if (isCapturing) return;
    setIsCapturing(true);
    setHoveredIndex(null);

    try {
      // Use combined command that closes picker before capture (handled in Rust)
      await invoke("capture_monitor_and_close_picker", { index });
    } catch (error) {
      console.error("Failed to capture monitor:", error);
    }
  };

  const handleClose = async () => {
    try {
      await invoke("hide_monitor_highlight");
      await invoke("close_monitor_picker");
    } catch (error) {
      console.error("Failed to close picker:", error);
    }
  };

  const getMonitorLayout = () => {
    if (monitors.length === 0 || containerSize.width === 0) {
      return { scale: 1, offsetX: 0, offsetY: 0, centerOffsetX: 0, centerOffsetY: 0 };
    }

    const minX = Math.min(...monitors.map(m => m.x));
    const minY = Math.min(...monitors.map(m => m.y));
    const maxX = Math.max(...monitors.map(m => m.x + m.width));
    const maxY = Math.max(...monitors.map(m => m.y + m.height));

    const totalWidth = maxX - minX;
    const totalHeight = maxY - minY;

    const padding = 24;
    const availableWidth = containerSize.width - padding * 2;
    const availableHeight = containerSize.height - padding * 2;

    const scaleX = availableWidth / totalWidth;
    const scaleY = availableHeight / totalHeight;
    const scale = Math.min(scaleX, scaleY);

    const layoutWidth = totalWidth * scale;
    const layoutHeight = totalHeight * scale;
    const centerOffsetX = (containerSize.width - layoutWidth) / 2;
    const centerOffsetY = (containerSize.height - layoutHeight) / 2;

    return { scale, offsetX: minX, offsetY: minY, centerOffsetX, centerOffsetY };
  };

  const layout = getMonitorLayout();
  const monitorGap = 6; // Gap between monitors in pixels

  return (
    <div className="h-screen w-screen glass-surface-2 flex flex-col select-none overflow-hidden" data-tauri-drag-region>
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10" data-tauri-drag-region>
        <span className="text-sm font-medium text-white">Select Monitor to Capture</span>
        <button
          onClick={handleClose}
          className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {monitors.map((monitor, idx) => (
          <button
            key={monitor.index}
            className={`absolute border-2 rounded-lg transition-all cursor-pointer flex items-center justify-center text-sm font-semibold ${
              hoveredIndex === idx
                ? "border-primary bg-primary/20 text-white"
                : "border-white/20 bg-white/5 text-white/70 hover:border-white/40 hover:bg-white/10"
            }`}
            style={{
              left: (monitor.x - layout.offsetX) * layout.scale + layout.centerOffsetX + monitorGap / 2,
              top: (monitor.y - layout.offsetY) * layout.scale + layout.centerOffsetY + monitorGap / 2,
              width: Math.max(monitor.width * layout.scale - monitorGap, 60),
              height: Math.max(monitor.height * layout.scale - monitorGap, 40),
            }}
            onMouseEnter={() => handleMouseEnter(idx)}
            onMouseLeave={handleMouseLeave}
            onClick={() => handleCapture(idx)}
          >
            <span className="flex flex-col items-center gap-0.5">
              <span>{idx + 1}</span>
              {monitor.is_primary && (
                <span className="text-[10px] opacity-70 font-medium">Primary</span>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-white/10">
        <div className="text-xs text-white/50 text-center">
          Press 1-{monitors.length} or click to capture
        </div>
      </div>
    </div>
  );
}
