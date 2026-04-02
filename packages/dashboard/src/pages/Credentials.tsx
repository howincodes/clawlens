import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  getSubscriptionCredentials,
  deleteSubscriptionCredential,
  refreshCredential,
  killUserCredential,
} from '../lib/api';

type Credential = {
  id: number;
  email: string;
  accountUuid?: string;
  orgId?: string;
  displayName?: string;
  organizationName?: string;
  subscriptionType?: string;
  rateLimitTier?: string;
  expiresAt?: string;
  isActive: boolean;
  needsReauth?: boolean;
  lastRefreshedAt?: string;
  createdAt: string;
  usage?: {
    fiveHourUtilization?: number;
    sevenDayUtilization?: number;
  };
  activeUsers: number;
  assignments: Array<{ userId: number; userName?: string; assignedAt: string }>;
};

function StatusBadge({ cred }: { cred: Credential }) {
  if (cred.needsReauth) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Needs Re-auth</span>;
  }
  if (cred.expiresAt) {
    const hoursLeft = (new Date(cred.expiresAt).getTime() - Date.now()) / (3600 * 1000);
    if (hoursLeft <= 0) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">Expired</span>;
    }
    if (hoursLeft <= 2) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Expiring</span>;
    }
  }
  if (!cred.isActive) {
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Inactive</span>;
  }
  return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>;
}

function UsageBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.round(value * 100));
  const color = pct >= 85 ? 'bg-red-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-green-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function Credentials() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [refreshingId, setRefreshingId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await getSubscriptionCredentials();
      setCredentials(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = async (id: number) => {
    setRefreshingId(id);
    try {
      await refreshCredential(id);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Refresh failed');
    } finally {
      setRefreshingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this credential? This cannot be undone.')) return;
    await deleteSubscriptionCredential(id);
    load();
  };

  const handleRevoke = async (userId: number) => {
    if (!confirm('Revoke credential from this user?')) return;
    await killUserCredential(userId);
    load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Credential Vault</h1>
          <p className="text-muted-foreground">Manage Claude Code OAuth subscriptions</p>
        </div>
        <Link
          to="/credentials/add"
          className="inline-flex items-center px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 font-medium text-sm"
        >
          + Add Subscription
        </Link>
      </div>

      {credentials.length === 0 ? (
        <div className="border rounded-lg p-12 text-center text-muted-foreground">
          <p className="text-lg mb-2">No credentials yet</p>
          <p>Click "Add Subscription" to connect a Claude account via OAuth.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {credentials.map((cred) => (
            <div key={cred.id} className="border rounded-lg p-4 space-y-3 bg-card">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{cred.email}</h3>
                  <p className="text-xs text-muted-foreground">{cred.organizationName || cred.orgId || 'No org'}</p>
                </div>
                <StatusBadge cred={cred} />
              </div>

              <div className="flex gap-2">
                {cred.subscriptionType && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 capitalize">
                    {cred.subscriptionType}
                  </span>
                )}
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                  {cred.activeUsers} user{cred.activeUsers !== 1 ? 's' : ''}
                </span>
              </div>

              <UsageBar label="5h Rate Limit" value={cred.usage?.fiveHourUtilization ?? 0} />
              <UsageBar label="7d Rate Limit" value={cred.usage?.sevenDayUtilization ?? 0} />

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setExpandedId(expandedId === cred.id ? null : cred.id)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {expandedId === cred.id ? 'Collapse' : 'Details'}
                </button>
                <button
                  onClick={() => handleRefresh(cred.id)}
                  disabled={refreshingId === cred.id}
                  className="text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50"
                >
                  {refreshingId === cred.id ? 'Refreshing...' : 'Refresh'}
                </button>
                {cred.needsReauth && (
                  <Link to="/credentials/add" className="text-xs text-red-600 hover:text-red-800">
                    Re-authenticate
                  </Link>
                )}
              </div>

              {expandedId === cred.id && (
                <div className="pt-2 border-t space-y-2">
                  <div className="text-xs space-y-1 text-muted-foreground">
                    <p>Account UUID: {cred.accountUuid || 'N/A'}</p>
                    <p>Expires: {cred.expiresAt ? new Date(cred.expiresAt).toLocaleString() : 'N/A'}</p>
                    <p>Last Refreshed: {cred.lastRefreshedAt ? new Date(cred.lastRefreshedAt).toLocaleString() : 'Never'}</p>
                    <p>Created: {new Date(cred.createdAt).toLocaleString()}</p>
                  </div>

                  {cred.assignments.length > 0 && (
                    <div>
                      <p className="text-xs font-medium mb-1">Assigned Users:</p>
                      {cred.assignments.map((a) => (
                        <div key={a.userId} className="flex items-center justify-between text-xs py-0.5">
                          <span>{a.userName || `User #${a.userId}`}</span>
                          <button
                            onClick={() => handleRevoke(a.userId)}
                            className="text-red-500 hover:text-red-700"
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={() => handleDelete(cred.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    Delete Credential
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
