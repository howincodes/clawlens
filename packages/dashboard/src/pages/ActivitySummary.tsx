import { useState, useEffect } from 'react';
import { getUserActivity, getUserActivityWindows } from '../lib/api';
import { useAuthStore } from '../store/authStore';

export default function ActivitySummary() {
  const { user } = useAuthStore();
  const [activity, setActivity] = useState<any>(null);
  const [windows, setWindows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    Promise.all([
      getUserActivity(user.id, new Date(today).toISOString()),
      getUserActivityWindows(user.id, today),
    ]).then(([act, wins]) => {
      setActivity(act);
      setWindows(wins);
    }).finally(() => setLoading(false));
  }, [user?.id]);

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;

  const totalFileEvents = activity?.fileEvents?.length || 0;
  const totalAppTime = activity?.appTracking?.reduce((sum: number, a: any) => sum + (a.durationSeconds || 0), 0) || 0;
  const totalWindows = windows.length;
  const totalWorkMinutes = windows.reduce((sum: number, w: any) => {
    const start = new Date(w.windowStart).getTime();
    const end = new Date(w.windowEnd).getTime();
    return sum + (end - start) / 60000;
  }, 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Today's Activity</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{Math.round(totalWorkMinutes)}</div>
          <div className="text-sm text-gray-500">Minutes Worked</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-600">{totalFileEvents}</div>
          <div className="text-sm text-gray-500">File Changes</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-purple-600">{totalWindows}</div>
          <div className="text-sm text-gray-500">Work Sessions</div>
        </div>
        <div className="bg-white border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-orange-600">{Math.round(totalAppTime / 60)}</div>
          <div className="text-sm text-gray-500">App Minutes</div>
        </div>
      </div>

      {windows.length > 0 && (
        <div className="bg-white border rounded-lg p-4 mb-6">
          <h3 className="font-semibold mb-3">Work Windows</h3>
          <div className="space-y-2">
            {windows.map((w: any, i: number) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="text-gray-500 font-mono">{new Date(w.windowStart).toLocaleTimeString()} - {new Date(w.windowEnd).toLocaleTimeString()}</span>
                <span className="text-gray-400">|</span>
                <span>{w.source}</span>
                <span className="text-gray-400">{w.eventCount} events</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activity?.appTracking?.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-3">App Usage</h3>
          <div className="space-y-1">
            {activity.appTracking.slice(0, 20).map((app: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm bg-gray-50 rounded px-3 py-1.5">
                <span>{app.appName || 'Unknown'}</span>
                <span className="text-gray-500">{Math.round((app.durationSeconds || 0) / 60)}m</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
