import { useState, useEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { FileText, ArrowLeft, Save, Eye, EyeOff } from "lucide-react";

interface SettingsProps {
    onBack: () => void;
}

export default function Settings({ onBack }: SettingsProps) {
    const {
        openaiBaseUrl,
        openaiApiKey,
        openaiModel,
        setOpenaiBaseUrl,
        setOpenaiApiKey,
        setOpenaiModel,
        saveSettings,
        loadSettings,
        isLoaded,
    } = useSettingsStore();

    const [showApiKey, setShowApiKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (!isLoaded) {
            loadSettings();
        }
    }, [isLoaded, loadSettings]);

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveSettings();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (error) {
            console.error("Failed to save settings:", error);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex h-screen bg-zinc-950 text-white">
            {/* Sidebar */}
            <aside className="w-64 border-r border-zinc-800 p-4">
                <h1 className="text-xl font-bold mb-8 flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <FileText size={18} />
                    </div>
                    OpenScribe
                </h1>

                <nav className="space-y-2">
                    <button
                        onClick={onBack}
                        className="w-full flex items-center gap-3 px-4 py-2 bg-zinc-900 rounded-md text-sm font-medium hover:bg-zinc-800 transition-colors"
                    >
                        <ArrowLeft size={16} />
                        Back to Dashboard
                    </button>
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="max-w-2xl">
                    <h2 className="text-2xl font-bold mb-8">Settings</h2>

                    <div className="space-y-6">
                        {/* OpenAI Base URL */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">
                                OpenAI Base URL
                            </label>
                            <input
                                type="url"
                                value={openaiBaseUrl}
                                onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                                placeholder="https://api.openai.com/v1"
                                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-blue-600 transition-colors"
                            />
                            <p className="mt-1 text-xs text-zinc-500">
                                Use a custom base URL for OpenAI-compatible APIs (e.g., Azure, local models)
                            </p>
                        </div>

                        {/* Model ID */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">
                                Model ID
                            </label>
                            <input
                                type="text"
                                value={openaiModel}
                                onChange={(e) => setOpenaiModel(e.target.value)}
                                placeholder="gpt-4o"
                                className="w-full px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-blue-600 transition-colors"
                            />
                            <p className="mt-1 text-xs text-zinc-500">
                                Model to use for generation (e.g., gpt-4o, gpt-4-turbo, claude-3-opus)
                            </p>
                        </div>

                        {/* API Key */}
                        <div>
                            <label className="block text-sm font-medium text-zinc-300 mb-2">
                                API Key
                            </label>
                            <div className="relative">
                                <input
                                    type={showApiKey ? "text" : "password"}
                                    value={openaiApiKey}
                                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full px-4 py-2 pr-10 bg-zinc-900 border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-blue-600 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowApiKey(!showApiKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                                >
                                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            <p className="mt-1 text-xs text-zinc-500">
                                Your API key is stored securely on your device
                            </p>
                        </div>

                        {/* Save Button */}
                        <div className="pt-4">
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                className={`flex items-center gap-2 px-6 py-2 rounded-md font-medium transition-colors ${
                                    saved
                                        ? "bg-green-600 hover:bg-green-700"
                                        : "bg-blue-600 hover:bg-blue-700"
                                } ${saving ? "opacity-50 cursor-not-allowed" : ""}`}
                            >
                                <Save size={16} />
                                {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
