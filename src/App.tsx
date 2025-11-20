import { useState } from "react";
import Dashboard from "./pages/Dashboard";
import Editor from "./pages/Editor";

function App() {
  const [view, setView] = useState<"dashboard" | "editor">("dashboard");

  if (view === "editor") {
    return <Editor onBack={() => setView("dashboard")} />;
  }

  return <Dashboard onGenerate={() => setView("editor")} />;
}

export default App;
