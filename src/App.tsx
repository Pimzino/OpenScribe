import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Dashboard from "./pages/Dashboard";
import NewRecording from "./pages/NewRecording";
import RecordingsList from "./pages/RecordingsList";
import RecordingDetail from "./pages/RecordingDetail";
import Editor from "./pages/Editor";
import Settings from "./pages/Settings";
import { useRecorderStore } from "./store/recorderStore";
import { useSettingsStore } from "./store/settingsStore";

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
    closeSplash();
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

    return () => {
      unlistenStart.then((f) => f());
      unlistenStop.then((f) => f());
    };
  }, [isRecording, setIsRecording, clearSteps, navigate]);

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/new-recording" element={<NewRecording />} />
      <Route path="/recordings" element={<RecordingsList />} />
      <Route path="/recordings/:id" element={<RecordingDetail />} />
      <Route path="/editor/:id?" element={<Editor />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  );
}

export default App;
