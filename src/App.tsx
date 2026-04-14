import { useEffect, lazy, Suspense } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import ToastHost from "./components/ToastHost";
import NotificationTray from "./components/notifications/NotificationTray";
import { loadRecordingDetail } from "./pages/loadRecordingDetail";

// Lazy load pages
const NewRecording = lazy(() => import("./pages/NewRecording"));
const RecordingsList = lazy(() => import("./pages/RecordingsList"));
const RecordingDetail = lazy(loadRecordingDetail);
const Settings = lazy(() => import("./pages/Settings"));
const MonitorPicker = lazy(() => import("./pages/MonitorPicker"));

import { useRecorderStore } from "./store/recorderStore";
import { useSettingsStore } from "./store/settingsStore";
import { useStartupStore, type StartupStatusPayload } from "./store/startupStore";
import { useToastStore } from "./store/toastStore";
import { useUpdateStore } from "./store/updateStore";
import { useNotificationStore } from "./store/notificationStore";
import UpdateNotification from "./components/UpdateNotification";

// Loading fallback component
const PageLoader = () => (
  <div className="flex items-center justify-center h-screen text-white/50">
    <div className="flex flex-col items-center gap-4">
      <div className="w-8 h-8 border-4 border-white/20 border-t-white/80 rounded-full animate-spin"></div>
      <p>Loading...</p>
    </div>
  </div>
);

let settingsHydrationPromise: Promise<void> | null = null;
let backgroundStartupPromise: Promise<void> | null = null;

function App() {
  const navigate = useNavigate();
  const { isRecording, setIsRecording } = useRecorderStore();
  const { isLoaded, sendScreenshotsToAi } = useSettingsStore();
  const isShellReady = useStartupStore((state) => state.isShellReady);

  useEffect(() => {
    if (isLoaded) {
      return;
    }

    if (!settingsHydrationPromise) {
      const startup = useStartupStore.getState();
      startup.applyStatus({
        task: "settings",
        state: "running",
        message: "Loading settings",
      });

      settingsHydrationPromise = useSettingsStore
        .getState()
        .hydrateSettings()
        .then(({ success, ocrEnabled }) => {
          startup.applyStatus({
            task: "settings",
            state: success ? "success" : "failed",
            message: success ? "Settings loaded" : "Settings loaded with defaults",
          });

          if (!ocrEnabled) {
            startup.markOcrDisabled();
          }
        });
    }

    void settingsHydrationPromise;
  }, [isLoaded]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    const attachStartupProgress = async () => {
      try {
        const snapshot = await invoke<StartupStatusPayload>("get_startup_status");
        if (!isDisposed) {
          useStartupStore.getState().applyStatus(snapshot, "backend");
        }
      } catch (error) {
        console.error("Failed to get startup status:", error);
      }

      try {
        unlisten = await listen<StartupStatusPayload>("startup-progress", (event) => {
          useStartupStore.getState().applyStatus(event.payload, "backend");
        });
      } catch (error) {
        console.error("Failed to listen for startup progress:", error);
      }
    };

    void attachStartupProgress();

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isLoaded || isShellReady) {
      return;
    }

    useStartupStore.getState().markShellReady();
  }, [isLoaded, isShellReady]);

  useEffect(() => {
    if (!isLoaded || !isShellReady) {
      return;
    }

    if (!backgroundStartupPromise) {
      backgroundStartupPromise = (async () => {
        const startup = useStartupStore.getState();
        const settingsStore = useSettingsStore.getState();

        if (!sendScreenshotsToAi) {
          startup.markOcrDisabled();
        }

        startup.applyStatus({
          phase: "background-startup",
          task: "hotkeys",
          state: "running",
          message: "Applying startup settings",
        });

        const syncResult = await settingsStore.syncSettingsToBackend();
        startup.applyStatus({
          phase: "background-startup",
          task: "hotkeys",
          state: syncResult.hotkeys ? "success" : "failed",
          message: syncResult.hotkeys ? "Hotkeys ready" : "Hotkey sync failed",
        });

        startup.applyStatus({
          phase: "background-startup",
          task: "notifications",
          state: "running",
          message: "Loading notifications",
        });
        const notificationsOk = await useNotificationStore.getState().fetchUnreadCount();
        startup.applyStatus({
          phase: "background-startup",
          task: "notifications",
          state: notificationsOk ? "success" : "failed",
          message: notificationsOk ? "Notifications ready" : "Notifications unavailable",
        });

        startup.applyStatus({
          phase: "background-startup",
          task: "updates",
          state: "running",
          message: "Checking for updates",
        });
        await useUpdateStore.getState().checkForUpdates();
        const updateError = useUpdateStore.getState().error;
        startup.applyStatus({
          phase: "background-startup",
          task: "updates",
          state: updateError ? "failed" : "success",
          message: updateError ? "Update check failed" : "Update check complete",
        });
      })();
    }

    void backgroundStartupPromise;
  }, [isLoaded, isShellReady, sendScreenshotsToAi]);

  // Listen for migration warnings from backend
  useEffect(() => {
    const unlistenMigration = listen<string>("migration-warning", (event) => {
      // Show a warning toast with longer duration for important migration messages
      useToastStore.getState().showToast({
        message: event.payload,
        variant: "info",
        durationMs: 10000, // 10 seconds - important message
        persist: true,
        title: "Migration",
      });
    });

    return () => {
      unlistenMigration.then((f) => f());
    };
  }, []);

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
  }, [isRecording, setIsRecording, navigate]);

  return (
    <>
      <ToastHost />
      <UpdateNotification />
      <NotificationTray />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<RecordingsList />} />
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
