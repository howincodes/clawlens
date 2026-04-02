import { useState, useEffect } from 'react';
import { getRoles, createRole, updateRoleApi, deleteRoleApi } from '../lib/api';
import RoleBadge from '../components/RoleBadge';
import PermissionMatrix from '../components/PermissionMatrix';

export default function Roles() {
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', description: '' });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editData, setEditData] = useState({ name: '', description: '' });
  const [activeView, setActiveView] = useState<'list' | 'matrix'>('list');

  const loadRoles = async () => {
    setLoading(true);
    try {
      const r = await getRoles();
      setRoles(r);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadRoles(); }, []);

  const handleCreate = async () => {
    if (!newRole.name.trim()) return;
    await createRole(newRole);
    setNewRole({ name: '', description: '' });
    setShowCreate(false);
    loadRoles();
  };

  const handleUpdate = async (id: number) => {
    await updateRoleApi(id, editData);
    setEditingId(null);
    loadRoles();
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this role?')) return;
    await deleteRoleApi(id);
    loadRoles();
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Roles & Permissions</h1>
        <div className="flex gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setActiveView('list')} className={`px-3 py-1.5 text-sm rounded-md ${activeView === 'list' ? 'bg-white shadow-sm font-medium' : 'text-gray-600'}`}>Roles</button>
            <button onClick={() => setActiveView('matrix')} className={`px-3 py-1.5 text-sm rounded-md ${activeView === 'matrix' ? 'bg-white shadow-sm font-medium' : 'text-gray-600'}`}>Permission Matrix</button>
          </div>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">+ New Role</button>
        </div>
      </div>

      {showCreate && (
        <div className="bg-white border rounded-xl p-4 mb-6 shadow-sm">
          <h3 className="font-semibold mb-3">Create Role</h3>
          <div className="flex gap-3 mb-3">
            <input type="text" placeholder="Role name" value={newRole.name} onChange={e => setNewRole({ ...newRole, name: e.target.value })} className="flex-1 border rounded-lg px-3 py-2 text-sm" autoFocus />
            <input type="text" placeholder="Description" value={newRole.description} onChange={e => setNewRole({ ...newRole, description: e.target.value })} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Create</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          </div>
        </div>
      )}

      {activeView === 'list' ? (
        loading ? <div className="text-center py-12 text-gray-500">Loading...</div> : (
          <div className="space-y-3">
            {roles.map(role => (
              <div key={role.id} className="bg-white border rounded-xl p-5">
                {editingId === role.id ? (
                  <div className="flex gap-3 items-center">
                    <input type="text" value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                    <input type="text" value={editData.description} onChange={e => setEditData({ ...editData, description: e.target.value })} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                    <button onClick={() => handleUpdate(role.id)} className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm">Save</button>
                    <button onClick={() => setEditingId(null)} className="px-3 py-2 text-sm text-gray-600">Cancel</button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <RoleBadge role={role.name} />
                      <div>
                        <div className="font-medium">{role.name}</div>
                        {role.description && <div className="text-sm text-gray-500">{role.description}</div>}
                      </div>
                      {role.isSystem && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded">System</span>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingId(role.id); setEditData({ name: role.name, description: role.description || '' }); }} className="text-sm text-blue-600 hover:underline">Edit</button>
                      {!role.isSystem && <button onClick={() => handleDelete(role.id)} className="text-sm text-red-500 hover:underline">Delete</button>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        <div className="bg-white border rounded-xl p-5">
          <PermissionMatrix />
        </div>
      )}
    </div>
  );
}
