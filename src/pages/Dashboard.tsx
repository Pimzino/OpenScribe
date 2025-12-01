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
        <div className="flex h-screen text-white">
            <Sidebar activePage="dashboard" onNavigate={handleNavigate} />

            {/* Main Content */}
            <main className="flex-1 p-8 overflow-auto">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-bold">Dashboard</h2>
                    <Tooltip content="New recording">
                        <button
                            onClick={() => navigate('/new-recording')}
                            className="p-2 bg-[#2721E8] hover:bg-[#4a45f5] rounded-md transition-colors"
                        >
                            <Plus size={18} />
                        </button>
                    </Tooltip>
                </div>

                {loading && !statistics ? (
                    <div className="flex items-center justify-center h-64">
                        <div className="text-white/50">Loading statistics...</div>
                    </div>
                ) : (
                    <>
                        {/* Statistics Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                            <div className="glass-surface-2 rounded-xl p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-[#2721E8]/20 rounded-lg flex items-center justify-center">
                                        <FileText size={20} className="text-[#2721E8]" />
                                    </div>
                                    <span className="text-white/70 text-sm">Total Recordings</span>
                                </div>
                                <p className="text-3xl font-bold">{statistics?.total_recordings || 0}</p>
                            </div>

                            <div className="glass-surface-2 rounded-xl p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-[#49B8D3]/20 rounded-lg flex items-center justify-center">
                                        <Layers size={20} className="text-[#49B8D3]" />
                                    </div>
                                    <span className="text-white/70 text-sm">Total Steps</span>
                                </div>
                                <p className="text-3xl font-bold">{statistics?.total_steps || 0}</p>
                            </div>

                            <div className="glass-surface-2 rounded-xl p-6">
                                <div className="flex items-center gap-3 mb-2">
                                    <div className="w-10 h-10 bg-green-600/20 rounded-lg flex items-center justify-center">
                                        <Clock size={20} className="text-green-500" />
                                    </div>
                                    <span className="text-white/70 text-sm">This Week</span>
                                </div>
                                <p className="text-3xl font-bold">{statistics?.recordings_this_week || 0}</p>
                            </div>
                        </div>

                        {/* Recent Recordings */}
                        <div className="glass-surface-2 rounded-xl">
                            <div className="flex justify-between items-center p-4 border-b border-white/8">
                                <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60">Recent Recordings</h3>
                                <button
                                    onClick={() => navigate('/recordings')}
                                    className="text-sm text-[#49B8D3] hover:text-[#5fc5e0]"
                                >
                                    View all
                                </button>
                            </div>

                            {statistics?.recent_recordings && statistics.recent_recordings.length > 0 ? (
                                <div className="divide-y divide-white/8">
                                    {statistics.recent_recordings.map((recording: Recording) => (
                                        <button
                                            key={recording.id}
                                            onClick={() => navigate(`/recordings/${recording.id}`)}
                                            className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors text-left"
                                        >
                                            <div>
                                                <p className="font-medium">{recording.name}</p>
                                                <p className="text-sm text-white/50">
                                                    {recording.step_count} steps
                                                </p>
                                            </div>
                                            <div className="text-sm text-white/50">
                                                {formatDate(recording.updated_at)}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="p-8 text-center text-white/50">
                                    <p>No recordings yet</p>
                                    <button
                                        onClick={() => navigate('/new-recording')}
                                        className="mt-2 text-[#49B8D3] hover:text-[#5fc5e0]"
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
