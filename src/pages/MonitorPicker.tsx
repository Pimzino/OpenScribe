import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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

  useEffect(() => {
    loadMonitors();

    // Handle escape key to close
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
      // Number keys 1-9 for quick selection
      const num = parseInt(e.key);
      if (num >= 1 && num <= monitors.length) {
        handleCapture(num - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [monitors.length]);

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
      // Hide the highlight overlay first
      await invoke("hide_monitor_highlight");
      // Wait for the overlay window to be fully destroyed by the OS
      await new Promise(resolve => setTimeout(resolve, 100));
      // Capture the monitor
      await invoke("capture_monitor", { index });
      // Close the picker window
      await invoke("close_monitor_picker");
    } catch (error) {
      console.error("Failed to capture monitor:", error);
      // Ensure highlight is hidden even on error
      try {
        await invoke("hide_monitor_highlight");
      } catch {}
    } finally {
      setIsCapturing(false);
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

  // Calculate layout for monitor thumbnails
  const getMonitorLayout = () => {
    if (monitors.length === 0) return { scale: 1, offsetX: 0, offsetY: 0 };

    const minX = Math.min(...monitors.map(m => m.x));
    const minY = Math.min(...monitors.map(m => m.y));
    const maxX = Math.max(...monitors.map(m => m.x + m.width));
    const maxY = Math.max(...monitors.map(m => m.y + m.height));

    const totalWidth = maxX - minX;
    const totalHeight = maxY - minY;

    // Scale to fit in container (300x150 max)
    const scaleX = 280 / totalWidth;
    const scaleY = 120 / totalHeight;
    const scale = Math.min(scaleX, scaleY, 0.1); // Max 10% of actual size

    return { scale, offsetX: minX, offsetY: minY };
  };

  const layout = getMonitorLayout();

  return (
    <div className="h-screen w-screen bg-zinc-900 flex flex-col select-none" data-tauri-drag-region>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700" data-tauri-drag-region>
        <span className="text-sm font-medium text-zinc-200">Select Monitor to Capture</span>
        <button
          onClick={handleClose}
          className="text-zinc-400 hover:text-white p-1 rounded hover:bg-zinc-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      {/* Monitor preview area */}
      <div className="flex-1 p-4 flex items-center justify-center">
        <div className="relative" style={{ width: 280, height: 120 }}>
          {monitors.map((monitor, idx) => (
            <button
              key={monitor.index}
              className={`absolute border-2 rounded transition-all cursor-pointer flex items-center justify-center text-xs font-bold ${
                hoveredIndex === idx
                  ? "border-green-500 bg-green-500/20 text-green-400"
                  : "border-zinc-600 bg-zinc-800 text-zinc-400 hover:border-zinc-500"
              }`}
              style={{
                left: (monitor.x - layout.offsetX) * layout.scale,
                top: (monitor.y - layout.offsetY) * layout.scale,
                width: monitor.width * layout.scale,
                height: monitor.height * layout.scale,
              }}
              onMouseEnter={() => handleMouseEnter(idx)}
              onMouseLeave={handleMouseLeave}
              onClick={() => handleCapture(idx)}
            >
              <span className="flex flex-col items-center gap-0.5">
                <span>{idx + 1}</span>
                {monitor.is_primary && (
                  <span className="text-[8px] opacity-60">Primary</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-zinc-700">
        <div className="text-xs text-zinc-500 text-center">
          Press 1-{monitors.length} or click to capture
        </div>
      </div>
    </div>
  );
}
