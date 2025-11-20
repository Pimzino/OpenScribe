import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import Editor from "./pages/Editor";
import Settings from "./pages/Settings";

function App() {
  const [view, setView] = useState<"dashboard" | "editor" | "settings">("dashboard");

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
