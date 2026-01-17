import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRecordingsStore, Recording } from "../store/recordingsStore";
import Pagination from "../components/Pagination";
import { useRecorderStore } from "../store/recorderStore";
import { FileText, Plus, Trash2, Search, X } from "lucide-react";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";
import DeleteProgressModal from "../components/DeleteProgressModal";

export default function RecordingsList() {
    const navigate = useNavigate();
    const { 
        recordings, 
        fetchRecordingsPaginated, 
        deleteRecording, 
        loading,
        currentPage,
        totalPages,
        nextPage,
        prevPage,
        deletionProgress,
        deletingRecordingName
    } = useRecordingsStore();
    const { clearSteps } = useRecorderStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);

    // Fetch recordings on mount
    useEffect(() => {
        fetchRecordingsPaginated(1, "");
    }, [fetchRecordingsPaginated]);

    // Debounced search effect
    useEffect(() => {
        const timer = setTimeout(() => {
            fetchRecordingsPaginated(1, searchQuery);
        }, 300);
        
        return () => clearTimeout(timer);
    }, [searchQuery, fetchRecordingsPaginated]);

    const handleDelete = (id: string, name: string) => {
        setDeleteConfirm(null);
        deleteRecording(id, name).catch(() => undefined);
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

    const handleNavigate = (page: "recordings" | "settings") => {
        if (page === "settings") navigate('/settings');
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
                                onClick={() => handleDelete(deleteConfirm.id, deleteConfirm.name)}
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
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 z-10 pointer-events-none" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search recordings..."
                        className="w-full pl-10 pr-10 py-2 bg-[#161316]/70 backdrop-blur-sm border border-white/10 rounded-md text-white placeholder-white/50 focus:outline-none focus:border-[#2721E8]"
                    />
                    {searchQuery && (
                        <button
                            onClick={() => setSearchQuery("")}
                            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-white/50 hover:text-white transition-colors"
                            aria-label="Clear search"
                        >
                            <X size={18} />
                        </button>
                    )}
                </div>

                {loading && recordings.length === 0 ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-white/50">Loading recordings...</div>
                    </div>
                ) : recordings.length > 0 ? (
                    <>
                    <div className="glass-surface-2 rounded-xl divide-y divide-white/8 overflow-hidden">
                        {recordings.map((recording: Recording) => (
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
                                                setDeleteConfirm({ id: recording.id, name: recording.name });
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
                    <Pagination
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPrevious={prevPage}
                        onNext={nextPage}
                        disabled={loading}
                    />
                    </>
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

            {/* Delete Progress Modal */}
            <DeleteProgressModal
                isOpen={deletionProgress !== null}
                recordingName={deletingRecordingName || ''}
                progress={deletionProgress}
            />
        </div>
    );
}
