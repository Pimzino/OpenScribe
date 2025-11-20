import { useState, useEffect } from "react";
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

type View = "dashboard" | "new-recording" | "recordings" | "recording-detail" | "editor" | "settings";

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
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
          setView("new-recording");
          await getCurrentWindow().setFocus();
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
  }, [isRecording, setIsRecording, clearSteps]);

  const navigateToRecording = (id: string) => {
    setSelectedRecordingId(id);
    setView("recording-detail");
  };

  if (view === "editor") {
    return (
      <Editor
        onBack={() => setView(selectedRecordingId ? "recording-detail" : "new-recording")}
        recordingId={selectedRecordingId}
      />
    );
  }

  if (view === "settings") {
    return (
      <Settings
        onBack={() => setView("dashboard")}
        onViewRecordings={() => setView("recordings")}
      />
    );
  }

  if (view === "new-recording") {
    return (
      <NewRecording
        onBack={() => setView("dashboard")}
        onGenerateWithSave={(id) => {
          setSelectedRecordingId(id);
          setView("editor");
        }}
        onSettings={() => setView("settings")}
        onSaved={(id) => {
          setSelectedRecordingId(id);
          setView("recording-detail");
        }}
      />
    );
  }

  if (view === "recordings") {
    return (
      <RecordingsList
        onBack={() => setView("dashboard")}
        onSelectRecording={navigateToRecording}
        onSettings={() => setView("settings")}
        onNewRecording={() => setView("new-recording")}
      />
    );
  }

  if (view === "recording-detail") {
    return (
      <RecordingDetail
        recordingId={selectedRecordingId!}
        onBack={() => {
          setSelectedRecordingId(null);
          setView("recordings");
        }}
        onEdit={() => setView("editor")}
        onSettings={() => setView("settings")}
      />
    );
  }

  return (
    <Dashboard
      onNewRecording={() => setView("new-recording")}
      onViewRecordings={() => setView("recordings")}
      onSelectRecording={navigateToRecording}
      onSettings={() => setView("settings")}
    />
  );
}

export default App;
