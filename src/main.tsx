import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { log, describeError } from "./lib/logger";

// Remove the splash screen immediately for the monitor-picker window so the
// picker UI is visible as soon as it loads. The main window keeps the splash
// until startup completes (handled by startupStore.markShellReady).
if (
  window.location.hash === "#/monitor-picker" ||
  window.location.hash.startsWith("#/monitor-picker/")
) {
  document.getElementById("splash")?.remove();
}

// Funnel unhandled errors and promise rejections into the file logger so we
// have a record even when the user can't reproduce the crash on demand.
window.addEventListener("error", (event) => {
  log.ui.error("Unhandled window error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    ...(event.error ? describeError(event.error).metadata : {}),
  });
});

window.addEventListener("unhandledrejection", (event) => {
  log.ui.error("Unhandled promise rejection", {
    ...describeError(event.reason).metadata,
  });
});

log.app.info("Frontend bootstrapping", { hash: window.location.hash });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
