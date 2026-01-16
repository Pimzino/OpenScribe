import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRecordingsStore, Recording } from "../store/recordingsStore";
import { useRecorderStore } from "../store/recorderStore";
import { FileText, Plus, Trash2, Search } from "lucide-react";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";

export default function RecordingsList() {
    const navigate = useNavigate();
    const { recordings, fetchRecordings, deleteRecording, loading } = useRecordingsStore();
    const { clearSteps } = useRecorderStore();
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

    const handleNewRecording = () => {
        clearSteps();
        navigate('/new-recording');
    };

    return (
        <div className="flex h-screen text-white">
            {/* Delete Confirmation Dialog */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="glass-surface-2 rounded-2xl p-6 w-96">
                        <h3 className="text-lg font-semibold mb-4">Delete Recording</h3>
                        <p className="text-white/70 mb-4">
                            Are you sure you want to delete this recording? This action cannot be undone.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className="px-4 py-2 rounded-md hover:bg-white/10 transition-colors"
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
                            onClick={handleNewRecording}
                            className="p-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-md transition-colors"
                        >
                            <Plus size={18} />
                        </button>
                    </Tooltip>
                </div>

                {/* Search */}
                <div className="relative mb-6">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search recordings..."
                        className="w-full pl-10 pr-4 py-2 bg-[#161316]/70 backdrop-blur-sm border border-white/10 rounded-md text-white placeholder-white/50 focus:outline-none focus:border-[#2721E8]"
                    />
                </div>

                {loading && recordings.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-white/50">Loading recordings...</div>
                    </div>
                ) : filteredRecordings.length > 0 ? (
                    <div className="glass-surface-2 rounded-xl divide-y divide-white/8 overflow-hidden">
                        {filteredRecordings.map((recording: Recording) => (
                            <div
                                key={recording.id}
                                className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
                            >
                                <button
                                    onClick={() => navigate(`/recordings/${recording.id}`)}
                                    className="flex-1 text-left"
                                >
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center">
                                            <FileText size={18} className="text-white/50" />
                                        </div>
                                        <div>
                                            <p className="font-medium">{recording.name}</p>
                                            <p className="text-sm text-white/50">
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
                                            className="p-2 hover:bg-white/10 rounded-md transition-colors text-white/60 hover:text-red-500"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </Tooltip>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-white/20 rounded-lg text-white/50">
                        {searchQuery ? (
                            <p>No recordings match "{searchQuery}"</p>
                        ) : (
                            <>
                                <p>No recordings yet</p>
                                <button
                                    onClick={handleNewRecording}
                                    className="mt-2 text-[#49B8D3] hover:text-[#49B8D3]/80"
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
