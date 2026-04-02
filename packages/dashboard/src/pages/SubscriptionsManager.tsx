import { useState, useEffect } from 'react';
import { getSubscriptionCredentials, createSubscriptionCredential, deleteSubscriptionCredential, getSubscriptionUsage, killUserCredential, rotateUserCredential, getSubscriptions, getProviderQuotas, getSubscriptionCredentialDetail } from '../lib/api';
import { SourceFilter } from '@/components/SourceFilter';
import { SourceBadge } from '@/components/SourceBadge';
import { QuotaBar } from '@/components/QuotaBar';
import UsageBar from '@/components/UsageBar';

// ── Helpers ───────────────────────────────────────────────

function planBadgeClass(plan: string): string {
  switch (plan?.toLowerCase()) {
    case 'go': return 'bg-green-100 text-green-700';
    case 'pro': return 'bg-blue-100 text-blue-700';
    case 'plus': return 'bg-purple-100 text-purple-700';
    case 'max': return 'bg-amber-100 text-amber-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function formatReset(unixTs: number | null | undefined): string {
  if (!unixTs) return 'N/A';
  const date = new Date(unixTs * 1000);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  if (diffMs < 0) return 'Expired';
  if (diffMs < 86400000) {
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    return `Resets in ${hours}h ${mins}m`;
  }
  return `Resets ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function getSubStatus(activeUntil: string | null | undefined): { color: string; label: string } {
  if (!activeUntil) return { color: 'bg-gray-400', label: 'Unknown' };
  const until = new Date(activeUntil);
  const now = new Date();
  const daysLeft = (until.getTime() - now.getTime()) / 86400000;
  if (daysLeft < 0) return { color: 'bg-red-500', label: 'Expired' };
  if (daysLeft < 7) return { color: 'bg-yellow-500', label: 'Expiring Soon' };
  return { color: 'bg-green-500', label: 'Active' };
}

// ── Component ─────────────────────────────────────────────

export default function SubscriptionsManager() {
  const [credentials, setCredentials] = useState<any[]>([]);
  const [usage, setUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newCred, setNewCred] = useState({ email: '', accessToken: '', refreshToken: '', subscriptionType: 'max' });

  // Subscription emails (from old Subscriptions page)
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [subsLoading, setSubsLoading] = useState(true);
  const [subsSource, setSubsSource] = useState('');
  const [quotaMap, setQuotaMap] = useState<Map<string, any[]>>(new Map());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [historyData, setHistoryData] = useState<any[]>([]);

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

  const loadSubscriptions = async () => {
    setSubsLoading(true);
    try {
      const res = await getSubscriptions(subsSource || undefined);
      const subs = res?.data || res?.subscriptions || [];
      setSubscriptions(subs);

      // Fetch quotas for Codex subscriptions
      const codexSubs = subs.filter((s: any) => s.source === 'codex' && s.users?.length > 0);
      const qMap = new Map<string, any[]>();
      await Promise.all(
        codexSubs.map(async (sub: any) => {
          try {
            const firstUser = sub.users[0];
            const quotaRes = await getProviderQuotas(String(firstUser.id), 'codex');
            if (quotaRes?.data) {
              qMap.set(sub.id || sub.email, quotaRes.data);
            }
          } catch {
            // Quota fetch is best-effort
          }
        })
      );
      setQuotaMap(qMap);
    } catch (err) {
      console.error('Failed to load subscriptions', err);
    } finally {
      setSubsLoading(false);
    }
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { loadSubscriptions(); }, [subsSource]);

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

  const loadHistory = async (credId: number) => {
    if (expandedId === credId) { setExpandedId(null); return; }
    try {
      const detail = await getSubscriptionCredentialDetail(credId);
      setHistoryData(detail.usageHistory || []);
    } catch {
      setHistoryData([]);
    }
    setExpandedId(credId);
  };

  const getUsageColor = (pct: number) => {
    if (pct >= 0.9) return 'text-red-600 bg-red-50';
    if (pct >= 0.75) return 'text-orange-600 bg-orange-50';
    if (pct >= 0.5) return 'text-yellow-600 bg-yellow-50';
    return 'text-green-600 bg-green-50';
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      {/* ── Section 1: Credential Cards ── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold">Subscriptions</h1>
            <p className="text-sm text-gray-500 mt-1">Manage credentials, usage, and subscription email accounts.</p>
          </div>
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
          <div className="text-center py-12 text-gray-500">Loading credentials...</div>
        ) : credentials.length === 0 ? (
          <div className="text-center py-12 text-gray-400 border border-dashed rounded-lg">
            <p className="text-lg mb-1">No credentials configured</p>
            <p className="text-sm">Add a subscription credential to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {credentials.map(cred => {
              const credUsage = usage.find((u: any) => u.id === cred.id);
              const u5h = credUsage?.usage?.fiveHourUtilization || 0;
              const u7d = credUsage?.usage?.sevenDayUtilization || 0;

              // Per-model usage if available
              const modelBreakdown = credUsage?.usage?.modelBreakdown || credUsage?.usage?.perModel || null;

              return (
                <div key={cred.id} className="bg-white border rounded-lg overflow-hidden shadow-sm">
                  {/* Header */}
                  <div className="p-4 bg-gray-50 border-b">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-base">{cred.email}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${planBadgeClass(cred.subscriptionType || 'pro')}`}>
                            {(cred.subscriptionType || 'pro').toUpperCase()}
                          </span>
                          <span className="text-xs text-gray-500">{cred.activeUsers || 0} active user(s)</span>
                        </div>
                      </div>
                      <button onClick={() => handleDelete(cred.id)} className="text-gray-400 hover:text-red-500 text-sm">Remove</button>
                    </div>
                  </div>

                  {/* Usage Bars */}
                  <div className="p-4 space-y-3">
                    <UsageBar value={u5h} max={1} label="5-Hour Window" size="md" />
                    <UsageBar value={u7d} max={1} label="7-Day Window" size="md" />

                    {/* Per-model usage */}
                    {modelBreakdown && (
                      <div className="pt-2 border-t space-y-2">
                        <div className="text-xs font-medium text-gray-500">Per-Model Usage</div>
                        {Object.entries(modelBreakdown).map(([model, usage]: [string, any]) => (
                          <div key={model} className="flex items-center justify-between text-xs">
                            <span className="capitalize font-medium">{model}</span>
                            <span className={`font-mono px-1.5 py-0.5 rounded ${getUsageColor(typeof usage === 'number' ? usage : (usage as any)?.utilization || 0)}`}>
                              {((typeof usage === 'number' ? usage : (usage as any)?.utilization || 0) * 100).toFixed(0)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* User Assignments */}
                  {cred.assignments && cred.assignments.length > 0 && (
                    <div className="p-4 border-t">
                      <div className="text-xs font-medium text-gray-500 mb-2">User Assignments</div>
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

                  {/* Usage History */}
                  <div className="p-4 border-t">
                    <button onClick={() => loadHistory(cred.id)} className="text-xs text-blue-600 hover:underline">
                      {expandedId === cred.id ? 'Hide History' : 'View History'}
                    </button>

                    {expandedId === cred.id && historyData.length > 0 && (
                      <div className="mt-3 pt-3 border-t">
                        <div className="text-xs text-gray-500 mb-2">Usage History (last {historyData.length} snapshots)</div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead><tr className="text-gray-500">
                              <th className="text-left py-1">Time</th>
                              <th className="text-right py-1">5h</th>
                              <th className="text-right py-1">7d</th>
                            </tr></thead>
                            <tbody>
                              {historyData.slice(0, 20).map((s: any, i: number) => (
                                <tr key={i} className="border-t border-gray-100">
                                  <td className="py-1">{new Date(s.recordedAt).toLocaleString()}</td>
                                  <td className="text-right">{((s.fiveHourUtilization || 0) * 100).toFixed(0)}%</td>
                                  <td className="text-right">{((s.sevenDayUtilization || 0) * 100).toFixed(0)}%</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {expandedId === cred.id && historyData.length === 0 && (
                      <p className="text-xs text-gray-400 mt-2">No usage history available.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section 2: User Assignments Overview ── */}
      {!loading && credentials.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">All User Assignments</h2>
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">User</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Subscription</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Type</th>
                  <th className="text-right px-4 py-2 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {credentials.flatMap(cred =>
                  (cred.assignments || []).map((a: any, i: number) => (
                    <tr key={`${cred.id}-${i}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{a.userName || `User ${a.userId}`}</td>
                      <td className="px-4 py-2">{cred.email}</td>
                      <td className="px-4 py-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${planBadgeClass(cred.subscriptionType || 'pro')}`}>
                          {(cred.subscriptionType || 'pro').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => handleRotate(a.userId)} className="text-blue-600 hover:underline text-xs mr-3">Rotate</button>
                        <button onClick={() => handleKill(a.userId)} className="text-red-600 hover:underline text-xs">Revoke</button>
                      </td>
                    </tr>
                  ))
                )}
                {credentials.flatMap(c => c.assignments || []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-gray-400">No user assignments found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Section 3: Subscription Emails ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Subscription Emails</h2>
          <SourceFilter value={subsSource} onChange={setSubsSource} />
        </div>
        <p className="text-sm text-gray-500 mb-4">Email accounts grouped by billing plan. Automatically created when users connect their CLI.</p>

        {subsLoading ? (
          <div className="text-center py-8 text-gray-500">Loading subscription emails...</div>
        ) : subscriptions.length === 0 ? (
          <div className="text-center py-8 border border-dashed rounded-lg text-gray-400">
            <p>No subscriptions found.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {subscriptions.map((sub: any) => {
              const subSource = sub.source || 'claude_code';
              const isCodex = subSource === 'codex';
              const quotas = quotaMap.get(sub.id || sub.email) || [];
              const subStatus = isCodex ? getSubStatus(sub.subscription_active_until) : null;

              return (
                <div key={sub.id || sub.email} className="bg-white border rounded-lg overflow-hidden shadow-sm">
                  {/* Header */}
                  <div className="p-4 bg-gray-50 border-b">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-sm truncate">{sub.email}</h3>
                          {!subsSource && <SourceBadge source={subSource} />}
                        </div>
                        <p className="text-xs text-gray-500">{sub.display_name || sub.org_name || sub.plan_name || 'Individual'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {subStatus && <span className={`w-2 h-2 rounded-full ${subStatus.color}`} title={subStatus.label} />}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${planBadgeClass(sub.subscription_type || sub.type || 'pro')}`}>
                          {(sub.subscription_type || sub.type || 'PRO').toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Codex subscription details */}
                  {isCodex && sub.subscription_active_start && (
                    <div className="p-3 border-b space-y-1 text-xs">
                      {sub.account_id && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Account</span>
                          <span className="font-mono text-[10px]">{sub.account_id.slice(0, 12)}...</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Active</span>
                        <span>
                          {new Date(sub.subscription_active_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          {' - '}
                          {sub.subscription_active_until
                            ? new Date(sub.subscription_active_until).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : 'Ongoing'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Quota bars for Codex */}
                  {quotas.length > 0 && (
                    <div className="p-3 border-b space-y-2">
                      {quotas.map((q: any, idx: number) => (
                        <QuotaBar
                          key={idx}
                          percent={q.used_percent ?? 0}
                          label={q.window_name === 'primary' ? 'Weekly Quota' : '5hr Quota'}
                          resetText={formatReset(q.resets_at)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 border-b text-center divide-x">
                    <div className="p-3 flex flex-col items-center justify-center">
                      <div className="text-lg font-bold">{sub.user_count ?? sub.users?.length ?? 0}</div>
                      <div className="text-[10px] text-gray-500">Users</div>
                    </div>
                    <div className="p-3 flex flex-col items-center justify-center">
                      <div className="text-lg font-bold">{sub.total_prompts || 0}</div>
                      <div className="text-[10px] text-gray-500">Prompts</div>
                    </div>
                    <div className="p-3 flex flex-col items-center justify-center">
                      <div className="text-lg font-bold">{sub.total_credits ?? Number(sub.total_cost || 0)}</div>
                      <div className="text-[10px] text-gray-500">Credits</div>
                    </div>
                  </div>

                  {/* Linked Users */}
                  <div className="p-3">
                    <h4 className="text-xs font-semibold mb-2">Linked Users</h4>
                    <div className="space-y-1 max-h-36 overflow-y-auto">
                      {sub.users?.length > 0 ? (
                        sub.users.map((u: any) => (
                          <div key={u.id} className="flex items-center justify-between text-xs p-1.5 rounded hover:bg-gray-50">
                            <span className="font-medium">{u.name}</span>
                            <div className="text-gray-400 flex gap-2">
                              <span>{u.prompts ?? u.usage?.prompts ?? u.prompt_count ?? 0} prompts</span>
                              <span>{u.credits ?? u.total_credits ?? 0} credits</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-[10px] text-gray-400 italic">No active users.</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
