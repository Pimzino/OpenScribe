
import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Lazy load pages
const Dashboard = lazy(() => import("./pages/Dashboard"));
const NewRecording = lazy(() => import("./pages/NewRecording"));
const RecordingsList = lazy(() => import("./pages/RecordingsList"));
const RecordingDetail = lazy(() => import("./pages/RecordingDetail"));
const Settings = lazy(() => import("./pages/Settings"));
const MonitorPicker = lazy(() => import("./pages/MonitorPicker"));

import { useRecorderStore } from "./store/recorderStore";
import { useSettingsStore } from "./store/settingsStore";

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center h-screen text-white/50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-8 h-8 border-4 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
      <p>Loading...</p>
    </div>
  </div>
);

function App() {
  const navigate = useNavigate();
  const { isRecording, setIsRecording, clearSteps } = useRecorderStore();
  const { startRecordingHotkey, stopRecordingHotkey, loadSettings, isLoaded } = useSettingsStore();

  // Load settings on mount
  useEffect(() => {
    if (!isLoaded) {
      loadSettings();
    }
  }, [isLoaded, loadSettings]);

  // Close splash screen when app is ready
  useEffect(() => {
    const closeSplash = async () => {
      await invoke("close_splashscreen");
    };
    closeSplash().catch(console.error);
  }, []);

  // Update backend hotkeys when settings change
  useEffect(() => {
    if (isLoaded) {
      invoke("set_hotkeys", {
        start: startRecordingHotkey,
        stop: stopRecordingHotkey,
      }).catch(console.error);
    }
  }, [startRecordingHotkey, stopRecordingHotkey, isLoaded]);

  // Listen for hotkey events
  useEffect(() => {
    const unlistenStart = listen("hotkey-start", async () => {
      if (!isRecording) {
        try {
          await invoke("start_recording");
          setIsRecording(true);
          // Don't clear steps to allow resume functionality
          navigate("/new-recording");
          // Minimize window to keep it out of the way during recording
          await getCurrentWindow().minimize();
        } catch (error) {
          console.error("Failed to start recording:", error);
        }
      }
    });

    const unlistenStop = listen("hotkey-stop", async () => {
      if (isRecording) {
        try {
          await invoke("stop_recording");
          setIsRecording(false);
          // Restore window when recording stops
          await getCurrentWindow().unminimize();
          await getCurrentWindow().setFocus();
        } catch (error) {
          console.error("Failed to stop recording:", error);
        }
      }
    });

    // Listen for capture hotkey - show monitor picker
    const unlistenCapture = listen("hotkey-capture", async () => {
      if (isRecording) {
        try {
          await invoke("show_monitor_picker");
        } catch (error) {
          console.error("Failed to show monitor picker:", error);
        }
      }
    });

    return () => {
      unlistenStart.then((f) => f());
      unlistenStop.then((f) => f());
      unlistenCapture.then((f) => f());
    };
  }, [isRecording, setIsRecording, clearSteps, navigate]);

  return (
    <>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/new-recording" element={<NewRecording />} />
          <Route path="/recordings" element={<RecordingsList />} />
          <Route path="/recordings/:id" element={<RecordingDetail />} />
          <Route path="/settings" element={<Settings />} />
          {/* Monitor selection route for separate window */}
          <Route path="/monitor-picker" element={<MonitorPicker />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default App;
