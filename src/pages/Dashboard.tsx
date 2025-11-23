import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useRecordingsStore, Recording } from "../store/recordingsStore";
import { FileText, Plus, Clock, Layers } from "lucide-react";
import Tooltip from "../components/Tooltip";
import Sidebar from "../components/Sidebar";

export default function Dashboard() {
    const navigate = useNavigate();
    const { statistics, fetchStatistics, loading } = useRecordingsStore();

    useEffect(() => {
        fetchStatistics();
    }, [fetchStatistics]);

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const handleNavigate = (page: "dashboard" | "recordings" | "settings") => {
        if (page === "recordings") navigate('/recordings');
        else if (page === "settings") navigate('/settings');
    };

    return (
        <div className="flex h-screen bg-zinc-950 text-white">
            <Sidebar activePage="dashboard" onNavigate={handleNavigate} />

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-bold">Dashboard</h2>
                    <Tooltip content="New recording">
                        <button
                            onClick={() => navigate('/new-recording')}
                            className="p-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                        >
                            <Plus size={18} />
                        </button>
                    </Tooltip>
                </div>

                {loading && !statistics ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-zinc-500">Loading statistics...</div>
                    </div>
                ) : (
                    <>
                        {/* Statistics Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-blue-600/20 rounded-lg flex items-center justify-center">
                                        <FileText size={20} className="text-blue-500" />
                                    </div>
                                    <span className="text-zinc-400 text-sm">Total Recordings</span>
                                </div>
                                <p className="text-3xl font-bold">{statistics?.total_recordings || 0}</p>
                            </div>

                            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-purple-600/20 rounded-lg flex items-center justify-center">
                                        <Layers size={20} className="text-purple-500" />
                                    </div>
                                    <span className="text-zinc-400 text-sm">Total Steps</span>
                                </div>
                                <p className="text-3xl font-bold">{statistics?.total_steps || 0}</p>
                            </div>

                            <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-green-600/20 rounded-lg flex items-center justify-center">
                                        <Clock size={20} className="text-green-500" />
                                    </div>
                                    <span className="text-zinc-400 text-sm">This Week</span>
                                </div>
                                <p className="text-3xl font-bold">{statistics?.recordings_this_week || 0}</p>
                            </div>
                        </div>

                        {/* Recent Recordings */}
                        <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
                            <div className="flex justify-between items-center p-4 border-b border-zinc-800">
                                <h3 className="font-semibold">Recent Recordings</h3>
                                <button
                                    onClick={() => navigate('/recordings')}
                                    className="text-sm text-blue-500 hover:text-blue-400"
                                >
                                    View all
                                </button>
                            </div>

                            {statistics?.recent_recordings && statistics.recent_recordings.length > 0 ? (
                                <div className="divide-y divide-zinc-800">
                                    {statistics.recent_recordings.map((recording: Recording) => (
                                        <button
                                            key={recording.id}
                                            onClick={() => navigate(`/recordings/${recording.id}`)}
                                            className="w-full flex items-center justify-between p-4 hover:bg-zinc-800/50 transition-colors text-left"
                                        >
                                            <div>
                                                <p className="font-medium">{recording.name}</p>
                                                <p className="text-sm text-zinc-500">
                                                    {recording.step_count} steps
                                                </p>
                                            </div>
                                            <div className="text-sm text-zinc-500">
                                                {formatDate(recording.updated_at)}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-zinc-500">
                                    <p>No recordings yet</p>
                                    <button
                                        onClick={() => navigate('/new-recording')}
                                        className="mt-2 text-blue-500 hover:text-blue-400"
                                    >
                                        Create your first recording
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
