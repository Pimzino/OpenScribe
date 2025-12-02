import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Monitor, AppWindow, Minimize2 } from "lucide-react";

interface MonitorInfo {
  index: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}

interface WindowInfo {
  id: number;
  title: string;
  app_name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_minimized: boolean;
}

export default function MonitorPicker() {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [hoveredMonitor, setHoveredMonitor] = useState<number | null>(null);
  const [hoveredWindow, setHoveredWindow] = useState<number | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
      const num = parseInt(e.key);
      if (num >= 1 && num <= monitors.length) {
        handleCaptureMonitor(num - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Cleanup overlay on unmount
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      // Ensure overlay is hidden when component unmounts
      invoke("hide_monitor_highlight").catch(() => {});
    };
  }, [monitors.length]);

  const loadData = async () => {
    try {
      const [monitorsResult, windowsResult] = await Promise.all([
        invoke<MonitorInfo[]>("get_monitors"),
        invoke<WindowInfo[]>("get_windows")
      ]);
      console.log("Monitors:", monitorsResult);
      console.log("Windows:", windowsResult);
      setMonitors(monitorsResult);
      setWindows(windowsResult);
    } catch (err) {
      console.error("Failed to load data:", err);
      setError(String(err));
    }
  };

  const handleMonitorEnter = async (index: number) => {
    setHoveredMonitor(index);
    setHoveredWindow(null);
    try {
      await invoke("show_monitor_highlight", { index });
    } catch (err) {
      console.error("Failed to show highlight:", err);
    }
  };

  const handleWindowEnter = async (windowId: number, isMinimized: boolean) => {
    setHoveredWindow(windowId);
    setHoveredMonitor(null);
    if (!isMinimized) {
      try {
        await invoke("show_window_highlight", { windowId });
      } catch (err) {
        console.error("Failed to show window highlight:", err);
      }
    }
  };

  const handleMouseLeave = async () => {
    setHoveredMonitor(null);
    setHoveredWindow(null);
    try {
      await invoke("hide_monitor_highlight");
    } catch (err) {
      console.error("Failed to hide highlight:", err);
    }
  };

  const handleCaptureMonitor = async (index: number) => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      await invoke("capture_monitor_and_close_picker", { index });
    } catch (err) {
      console.error("Failed to capture monitor:", err);
      setIsCapturing(false);
    }
  };

  const handleCaptureWindow = async (windowId: number) => {
    if (isCapturing) return;
    setIsCapturing(true);
    try {
      await invoke("capture_window_and_close_picker", { windowId });
    } catch (err) {
      console.error("Failed to capture window:", err);
      setIsCapturing(false);
    }
  };

  const handleClose = async () => {
    try {
      await invoke("hide_monitor_highlight");
      await invoke("close_monitor_picker");
    } catch (err) {
      console.error("Failed to close:", err);
    }
  };

  return (
    <div className="h-screen w-screen bg-gray-900/95 flex flex-col select-none overflow-hidden" data-tauri-drag-region>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gray-800/50" data-tauri-drag-region>
        <span className="text-sm font-medium text-white">Select Capture Target</span>
        <button
          onClick={handleClose}
          className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-500/20 text-red-400 text-sm">
          Error: {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Monitors Section */}
        {monitors.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-xs text-white/50 uppercase tracking-wide mb-3">
              <Monitor size={14} />
              <span>Monitors ({monitors.length})</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {monitors.map((monitor, idx) => (
                <button
                  key={monitor.index}
                  className={`p-3 rounded-lg border-2 transition-all text-left ${
                    hoveredMonitor === idx
                      ? "border-green-500 bg-green-500/20 text-white"
                      : "border-white/20 bg-white/5 text-white/80 hover:border-white/40 hover:bg-white/10"
                  }`}
                  onMouseEnter={() => handleMonitorEnter(idx)}
                  onMouseLeave={handleMouseLeave}
                  onClick={() => handleCaptureMonitor(idx)}
                >
                  <div className="flex items-center gap-2">
                    <Monitor size={16} className="text-white/60" />
                    <span className="font-medium">Monitor {idx + 1}</span>
                    {monitor.is_primary && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/30 text-blue-300 rounded">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-white/40 mt-1">
                    {monitor.width} × {monitor.height}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Windows Section */}
        <div>
          <div className="flex items-center gap-2 text-xs text-white/50 uppercase tracking-wide mb-3">
            <AppWindow size={14} />
            <span>Windows ({windows.length})</span>
          </div>

          {windows.length === 0 ? (
            <div className="text-sm text-white/40 text-center py-6 bg-white/5 rounded-lg">
              No capturable windows found
            </div>
          ) : (
            <div className="space-y-1">
              {windows.map((win) => (
                <button
                  key={win.id}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                    hoveredWindow === win.id
                      ? "bg-green-500/20 border border-green-500"
                      : "bg-white/5 border border-transparent hover:bg-white/10 hover:border-white/20"
                  }`}
                  onMouseEnter={() => handleWindowEnter(win.id, win.is_minimized)}
                  onMouseLeave={handleMouseLeave}
                  onClick={() => handleCaptureWindow(win.id)}
                >
                  <div className="flex items-center gap-2">
                    <AppWindow size={14} className="text-white/40 flex-shrink-0" />
                    <span className="text-sm text-white truncate flex-1">
                      {win.title || win.app_name || "Untitled"}
                    </span>
                    {win.is_minimized && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-[10px] rounded flex-shrink-0">
                        <Minimize2 size={10} />
                        Minimized
                      </span>
                    )}
                  </div>
                  {win.app_name && win.title && (
                    <div className="text-xs text-white/40 truncate mt-0.5 ml-6">
                      {win.app_name}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-white/10 bg-gray-800/50">
        <div className="text-xs text-white/50 text-center">
          {monitors.length > 0 ? `Press 1-${monitors.length} for monitors • ` : ""}
          Click to capture • ESC to cancel
        </div>
      </div>
    </div>
  );
}
