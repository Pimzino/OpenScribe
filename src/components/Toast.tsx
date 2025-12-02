import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle, X } from "lucide-react";

export default function Toast() {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<string>("show-toast", (event) => {
      setMessage(event.payload);
      setTimeout(() => setMessage(null), 2500);
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  if (!message) return null;

  return (
    <div className="fixed bottom-4 right-4 flex items-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg shadow-xl z-[9999] animate-in slide-in-from-bottom-2 duration-200">
      <CheckCircle size={18} />
      <span className="text-sm font-medium">{message}</span>
      <button
        onClick={() => setMessage(null)}
        className="ml-2 p-1 hover:bg-white/20 rounded"
      >
        <X size={14} />
      </button>
    </div>
  );
}
