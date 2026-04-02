import { useState, useEffect } from 'react';
import { getRoles, getPermissions, getRolePermissions, setRolePermissions } from '../lib/api';

export default function PermissionMatrix() {
  const [roles, setRoles] = useState<any[]>([]);
  const [permissions, setPermissions] = useState<any[]>([]);
  const [matrix, setMatrix] = useState<Record<number, Set<number>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [r, p] = await Promise.all([getRoles(), getPermissions()]);
      setRoles(r);
      setPermissions(p);

      const m: Record<number, Set<number>> = {};
      for (const role of r) {
        const perms = await getRolePermissions(role.id);
        m[role.id] = new Set(perms.map((rp: any) => rp.permissionId));
      }
      setMatrix(m);
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (roleId: number, permId: number) => {
    const current = matrix[roleId] || new Set();
    const updated = new Set(current);
    if (updated.has(permId)) {
      updated.delete(permId);
    } else {
      updated.add(permId);
    }
    setMatrix({ ...matrix, [roleId]: updated });

    setSaving(roleId);
    try {
      await setRolePermissions(roleId, Array.from(updated));
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <div className="text-center py-8 text-gray-500">Loading permissions...</div>;

  // Group permissions by category
  const categories = permissions.reduce((acc: Record<string, any[]>, p: any) => {
    (acc[p.category] = acc[p.category] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2 px-3 font-medium text-gray-600">Permission</th>
            {roles.map(r => (
              <th key={r.id} className="text-center py-2 px-3 font-medium text-gray-600 min-w-[80px]">
                {r.name}
                {saving === r.id && <span className="ml-1 text-xs text-blue-500">...</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(categories).map(([category, perms]) => (
            <>
              <tr key={`cat-${category}`}>
                <td colSpan={roles.length + 1} className="py-2 px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider bg-gray-50">{category}</td>
              </tr>
              {(perms as any[]).map((p: any) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-700">{p.name}</td>
                  {roles.map(r => (
                    <td key={r.id} className="text-center py-2 px-3">
                      <input
                        type="checkbox"
                        checked={matrix[r.id]?.has(p.id) || false}
                        onChange={() => toggle(r.id, p.id)}
                        className="rounded text-blue-600 cursor-pointer"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}
