import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRecordingsStore, Recording } from "../store/recordingsStore";
import { FileText, Plus, Trash2, Search } from "lucide-react";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";

export default function RecordingsList() {
    const navigate = useNavigate();
    const { recordings, fetchRecordings, deleteRecording, loading } = useRecordingsStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    useEffect(() => {
        fetchRecordings();
    }, [fetchRecordings]);

    const filteredRecordings = recordings.filter(recording =>
        recording.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const handleDelete = async (id: string) => {
        await deleteRecording(id);
        setDeleteConfirm(null);
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleNavigate = (page: "dashboard" | "recordings" | "settings") => {
        if (page === "dashboard") navigate('/');
        else if (page === "settings") navigate('/settings');
    };

    return (
        <div className="flex h-screen bg-zinc-950 text-white">
            {/* Delete Confirmation Dialog */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 w-96">
                        <h3 className="text-lg font-semibold mb-4">Delete Recording</h3>
                        <p className="text-zinc-400 mb-4">
                            Are you sure you want to delete this recording? This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 rounded-md hover:bg-zinc-800 transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-md font-medium transition-colors"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Sidebar activePage="recordings" onNavigate={handleNavigate} />

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-bold">My Recordings</h2>
                    <Tooltip content="New recording">
                        <button
                            onClick={() => navigate('/new-recording')}
                            className="p-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                        >
                            <Plus size={18} />
                        </button>
                    </Tooltip>
                </div>

                {/* Search */}
                <div className="relative mb-6">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search recordings..."
                        className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-md text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                    />
                </div>

                {loading && recordings.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-zinc-500">Loading recordings...</div>
                    </div>
                ) : filteredRecordings.length > 0 ? (
                    <div className="bg-zinc-900 border border-zinc-800 rounded-lg divide-y divide-zinc-800">
                        {filteredRecordings.map((recording: Recording) => (
                            <div
                                key={recording.id}
                                className="flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors"
                            >
                                <button
                                    onClick={() => navigate(`/recordings/${recording.id}`)}
                                    className="flex-1 text-left"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
                                            <FileText size={18} className="text-zinc-500" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{recording.name}</p>
                                            <p className="text-sm text-zinc-500">
                                                {recording.step_count} steps • {formatDate(recording.updated_at)}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                                <div className="flex items-center gap-2">
                                    <Tooltip content="Delete recording">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setDeleteConfirm(recording.id);
                                            }}
                                            className="p-2 hover:bg-zinc-700 rounded-md transition-colors text-zinc-400 hover:text-red-500"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-800 rounded-lg text-zinc-500">
                        {searchQuery ? (
                            <p>No recordings match "{searchQuery}"</p>
                        ) : (
                            <>
                                <p>No recordings yet</p>
                                <button
                                    onClick={() => navigate('/new-recording')}
                                    className="mt-2 text-blue-500 hover:text-blue-400"
                                >
                                    Create your first recording
                                </button>
                            </>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
