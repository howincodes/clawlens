import { useState, useEffect } from 'react';
import { getRoles } from '../lib/api';

export default function AssignRoleModal({ open, onClose, onAssign, userName }: {
  open: boolean;
  onClose: () => void;
  onAssign: (roleId: number) => void;
  userName: string;
}) {
  const [roles, setRoles] = useState<any[]>([]);
  const [selectedRole, setSelectedRole] = useState<number | null>(null);

  useEffect(() => {
    if (open) getRoles().then(setRoles).catch(() => {});
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 className="text-lg font-semibold mb-2">Assign Role</h2>
        <p className="text-sm text-gray-500 mb-4">Select a role for {userName}</p>
        <div className="space-y-2 mb-6">
          {roles.map(r => (
            <label key={r.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedRole === r.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
              <input type="radio" name="role" value={r.id} checked={selectedRole === r.id} onChange={() => setSelectedRole(r.id)} className="text-blue-600" />
              <div>
                <div className="font-medium text-sm">{r.name}</div>
                {r.description && <div className="text-xs text-gray-500">{r.description}</div>}
              </div>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={() => selectedRole && onAssign(selectedRole)} disabled={!selectedRole} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}
