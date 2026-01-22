import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Monitor, AppWindow, Minimize2, ChevronDown } from "lucide-react";

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
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [windowDropdownOpen, setWindowDropdownOpen] = useState(false);

  // Refs for debouncing window highlights
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHighlightedRef = useRef<number | null>(null);

  useEffect(() => {
    loadData();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (windowDropdownOpen) {
          setWindowDropdownOpen(false);
        } else {
          handleClose();
        }
      }
      const num = parseInt(e.key);
      if (num >= 1 && num <= monitors.length && !windowDropdownOpen) {
        handleCaptureMonitor(num - 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    // Cleanup overlay on unmount
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
      invoke("hide_monitor_highlight").catch(() => {});
    };
  }, [monitors.length, windowDropdownOpen]);

  const loadData = async () => {
    try {
      const [monitorsResult, windowsResult] = await Promise.all([
        invoke<MonitorInfo[]>("get_monitors"),
        invoke<WindowInfo[]>("get_windows")
      ]);
      setMonitors(monitorsResult);
      setWindows(windowsResult);
    } catch (err) {
      console.error("Failed to load data:", err);
      setError(String(err));
    }
  };

  const handleMonitorEnter = async (index: number) => {
    setHoveredMonitor(index);
    try {
      await invoke("hide_monitor_highlight");
      await invoke("show_monitor_highlight", { index });
    } catch (err) {
      console.error("Failed to show highlight:", err);
    }
  };

  const handleMonitorLeave = async () => {
    setHoveredMonitor(null);
    try {
      await invoke("hide_monitor_highlight");
    } catch (err) {
      console.error("Failed to hide highlight:", err);
    }
  };

  const handleWindowHover = useCallback(async (win: WindowInfo) => {
    // Skip minimized windows entirely
    if (win.is_minimized) {
      return;
    }

    // Skip if same window already highlighted
    if (lastHighlightedRef.current === win.id) {
      return;
    }

    // Clear any pending highlight
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    // Debounce: wait 50ms before showing highlight
    hoverTimeoutRef.current = setTimeout(async () => {
      try {
        await invoke("hide_monitor_highlight");
        await invoke("show_highlight_at_bounds", {
          bounds: {
            x: win.x,
            y: win.y,
            width: win.width,
            height: win.height
          }
        });
        lastHighlightedRef.current = win.id;
      } catch (err) {
        console.error("Failed to show window highlight:", err);
      }
    }, 50);
  }, []);

  const handleWindowLeave = useCallback(async () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    lastHighlightedRef.current = null;

    try {
      await invoke("hide_monitor_highlight");
    } catch (err) {
      console.error("Failed to hide highlight:", err);
    }
  }, []);

  const handleCaptureMonitor = async (index: number) => {
    if (isCapturing) return;
    setIsCapturing(true);
    setError(null);
    try {
      await invoke("capture_monitor_and_close_picker", { index });
    } catch (err) {
      console.error("Failed to capture monitor:", err);
      setError(String(err));
      setIsCapturing(false);
    }
  };

  const handleCaptureWindow = async (win: WindowInfo) => {
    if (isCapturing) return;
    setIsCapturing(true);
    setWindowDropdownOpen(false);
    setError(null);
    try {
      await invoke("capture_window_and_close_picker", {
        windowId: win.id,
        isMinimized: win.is_minimized
      });
    } catch (err) {
      console.error("Failed to capture window:", err);
      setError(String(err));
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
    <div className="h-screen w-screen glass-surface-2 flex flex-col select-none overflow-hidden" data-tauri-drag-region>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10" data-tauri-drag-region>
        <span className="text-base font-medium text-white">Select Capture Target</span>
        <button
          onClick={handleClose}
          className="text-white/60 hover:text-white p-2 rounded-lg hover:bg-white/10 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {error && (
        <div className="px-5 py-3 bg-red-500/20 text-red-400 text-sm border-b border-red-500/20">
          Error: {error}
        </div>
      )}

      <div className="flex-1 p-5 space-y-5 overflow-y-auto">
        {/* Monitors Section */}
        {monitors.length > 0 && (
          <div>
            <label className="flex items-center gap-2 text-sm text-white/60 uppercase tracking-wide mb-3">
              <Monitor size={14} />
              <span>Monitors</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {monitors.map((monitor, idx) => (
                <button
                  key={monitor.index}
                  className={`p-4 rounded-xl border transition-all text-left ${
                    hoveredMonitor === idx
                      ? "border-primary bg-primary/20 text-white"
                      : "border-white/10 glass-surface-3 text-white/80 hover:border-white/20 hover:bg-white/5"
                  }`}
                  onMouseEnter={() => handleMonitorEnter(idx)}
                  onMouseLeave={handleMonitorLeave}
                  onClick={() => handleCaptureMonitor(idx)}
                >
                  <div className="flex items-center gap-3">
                    <Monitor size={20} className="text-white/50" />
                    <span className="font-medium text-base">Monitor {idx + 1}</span>
                    {monitor.is_primary && (
                      <span className="text-xs px-2 py-0.5 bg-[#2721E8]/30 text-[#49B8D3] rounded">
                        Primary
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-white/40 mt-2 ml-8">
                    {monitor.width} × {monitor.height}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Windows Dropdown */}
        <div>
          <label className="flex items-center gap-2 text-sm text-white/60 uppercase tracking-wide mb-3">
            <AppWindow size={14} />
            <span>Window</span>
          </label>

          {windows.length === 0 ? (
            <div className="text-base text-white/40 text-center py-6 glass-surface-3 rounded-xl border border-white/10">
              No capturable windows found
            </div>
          ) : (
            <div className="relative">
              <button
                onClick={() => setWindowDropdownOpen(!windowDropdownOpen)}
                className="w-full px-4 py-3.5 glass-surface-3 rounded-xl text-white text-left flex items-center justify-between border border-white/10 hover:border-white/20 transition-colors"
              >
                <span className="flex items-center gap-3 truncate">
                  <AppWindow size={18} className="text-white/50 flex-shrink-0" />
                  <span className="truncate text-white/70 text-base">Select a window...</span>
                </span>
                <ChevronDown size={20} className={`text-white/50 transition-transform flex-shrink-0 ${windowDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {windowDropdownOpen && (
                <div className="absolute z-10 w-full mt-2 glass-surface-3 rounded-xl shadow-lg max-h-60 overflow-y-auto border border-white/10">
                  {windows.map((win) => (
                    <button
                      key={win.id}
                      onMouseEnter={() => handleWindowHover(win)}
                      onMouseLeave={handleWindowLeave}
                      onClick={() => handleCaptureWindow(win)}
                      className="w-full px-4 py-3 text-left hover:bg-white/10 transition-colors flex items-center gap-3"
                    >
                      <AppWindow size={18} className="text-white/40 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-base text-white truncate">
                          {win.title || win.app_name || "Untitled"}
                        </div>
                        {win.app_name && win.title && (
                          <div className="text-sm text-white/40 truncate">
                            {win.app_name}
                          </div>
                        )}
                      </div>
                      {win.is_minimized && (
                        <span className="flex items-center gap-1 px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded flex-shrink-0">
                          <Minimize2 size={12} />
                          Min
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-white/10">
        <div className="text-sm text-white/50 text-center">
          {monitors.length > 0 ? `Press 1-${monitors.length} for monitors • ` : ""}
          Click to capture • ESC to cancel
        </div>
      </div>
    </div>
  );
}
