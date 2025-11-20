import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Dashboard from "./pages/Dashboard";
import Editor from "./pages/Editor";
import Settings from "./pages/Settings";
import { useRecorderStore } from "./store/recorderStore";
import { useSettingsStore } from "./store/settingsStore";

function App() {
  const [view, setView] = useState<"dashboard" | "editor" | "settings">("dashboard");
  const { isRecording, setIsRecording, clearSteps } = useRecorderStore();
  const { startRecordingHotkey, stopRecordingHotkey, loadSettings, isLoaded } = useSettingsStore();

  // Load settings on mount
  useEffect(() => {
    if (!isLoaded) {
      loadSettings();
    }
  }, [isLoaded, loadSettings]);

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
          clearSteps();
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
        } catch (error) {
          console.error("Failed to stop recording:", error);
        }
      }
    });

    return () => {
      unlistenStart.then((f) => f());
      unlistenStop.then((f) => f());
    };
  }, [isRecording, setIsRecording, clearSteps]);

  if (view === "editor") {
    return <Editor onBack={() => setView("dashboard")} />;
  }

  if (view === "settings") {
    return <Settings onBack={() => setView("dashboard")} />;
  }

  return (
    <Dashboard
      onGenerate={() => setView("editor")}
      onSettings={() => setView("settings")}
    />
  );
}

export default App;
