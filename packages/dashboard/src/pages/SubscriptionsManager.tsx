import { useState, useEffect } from 'react';
import { getSubscriptionCredentials, createSubscriptionCredential, deleteSubscriptionCredential, getSubscriptionUsage, killUserCredential, rotateUserCredential } from '../lib/api';

export default function SubscriptionsManager() {
  const [credentials, setCredentials] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newCred, setNewCred] = useState({ email: '', accessToken: '', refreshToken: '', subscriptionType: 'max' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [creds, usg] = await Promise.all([getSubscriptionCredentials(), getSubscriptionUsage()]);
      setCredentials(creds);
      setUsage(usg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);

  // Auto-refresh usage every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const usg = await getSubscriptionUsage();
        setUsage(usg);
      } catch {}
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = async () => {
    if (!newCred.email) return;
    await createSubscriptionCredential(newCred);
    setNewCred({ email: '', accessToken: '', refreshToken: '', subscriptionType: 'max' });
    setShowAdd(false);
    loadData();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Remove this subscription credential?')) return;
    await deleteSubscriptionCredential(id);
    loadData();
  };

  const handleKill = async (userId: number) => {
    await killUserCredential(userId);
    loadData();
  };

  const handleRotate = async (userId: number) => {
    await rotateUserCredential(userId);
    loadData();
  };

  const getUsageColor = (pct: number) => {
    if (pct >= 0.9) return 'text-red-600 bg-red-50';
    if (pct >= 0.75) return 'text-orange-600 bg-orange-50';
    if (pct >= 0.5) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          + Add Credential
        </button>
      </div>

      {showAdd && (
        <div className="bg-white border rounded-lg p-4 mb-6 shadow-sm">
          <h3 className="font-semibold mb-3">Add Subscription Credential</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <input type="email" placeholder="Email" value={newCred.email} onChange={e => setNewCred({ ...newCred, email: e.target.value })} className="border rounded px-3 py-2" />
            <select value={newCred.subscriptionType} onChange={e => setNewCred({ ...newCred, subscriptionType: e.target.value })} className="border rounded px-3 py-2">
              <option value="pro">Pro</option>
              <option value="max">Max</option>
              <option value="team">Team</option>
            </select>
            <input type="password" placeholder="Access Token" value={newCred.accessToken} onChange={e => setNewCred({ ...newCred, accessToken: e.target.value })} className="border rounded px-3 py-2" />
            <input type="password" placeholder="Refresh Token" value={newCred.refreshToken} onChange={e => setNewCred({ ...newCred, refreshToken: e.target.value })} className="border rounded px-3 py-2" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Add</button>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">Cancel</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <div className="grid gap-4">
          {credentials.map(cred => {
            const credUsage = usage.find((u: any) => u.id === cred.id);
            const u5h = credUsage?.usage?.fiveHourUtilization || 0;
            const u7d = credUsage?.usage?.sevenDayUtilization || 0;

            return (
              <div key={cred.id} className="bg-white border rounded-lg p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-lg">{cred.email}</h3>
                    <span className="text-sm text-gray-500">{cred.subscriptionType || 'pro'} &bull; {cred.activeUsers || 0} active user(s)</span>
                  </div>
                  <button onClick={() => handleDelete(cred.id)} className="text-gray-400 hover:text-red-500">Remove</button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <div className="text-sm text-gray-500 mb-1">5-Hour Window</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-3">
                        <div className={`h-3 rounded-full ${u5h >= 0.8 ? 'bg-red-500' : u5h >= 0.5 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(u5h * 100, 100)}%` }} />
                      </div>
                      <span className={`text-sm font-mono px-2 py-0.5 rounded ${getUsageColor(u5h)}`}>{(u5h * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-500 mb-1">7-Day Window</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-3">
                        <div className={`h-3 rounded-full ${u7d >= 0.8 ? 'bg-red-500' : u7d >= 0.5 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(u7d * 100, 100)}%` }} />
                      </div>
                      <span className={`text-sm font-mono px-2 py-0.5 rounded ${getUsageColor(u7d)}`}>{(u7d * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </div>

                {cred.assignments && cred.assignments.length > 0 && (
                  <div>
                    <div className="text-sm text-gray-500 mb-2">Active Users</div>
                    <div className="space-y-1">
                      {cred.assignments.map((a: any, i: number) => (
                        <div key={i} className="flex items-center justify-between bg-gray-50 rounded px-3 py-1.5 text-sm">
                          <span>{a.userName || `User ${a.userId}`}</span>
                          <div className="flex gap-2">
                            <button onClick={() => handleRotate(a.userId)} className="text-blue-600 hover:underline text-xs">Rotate</button>
                            <button onClick={() => handleKill(a.userId)} className="text-red-600 hover:underline text-xs">Revoke</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
