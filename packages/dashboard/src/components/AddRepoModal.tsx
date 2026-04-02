import { useState } from 'react';
import { addProjectRepositoryApi } from '../lib/api';

export default function AddRepoModal({ open, onClose, projectId, onAdded }: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleAdd = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      await addProjectRepositoryApi(projectId, { githubRepoUrl: url, label: label || undefined });
      setUrl('');
      setLabel('');
      onAdded();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4">Add Repository</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">GitHub URL *</label>
            <input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://github.com/org/repo" className="w-full border rounded-lg px-3 py-2" autoFocus />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
            <select value={label} onChange={e => setLabel(e.target.value)} className="w-full border rounded-lg px-3 py-2">
              <option value="">Select type...</option>
              <option value="backend">Backend</option>
              <option value="frontend">Frontend</option>
              <option value="mobile">Mobile App</option>
              <option value="infra">Infrastructure</option>
              <option value="docs">Documentation</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button onClick={handleAdd} disabled={!url.trim() || loading} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Adding...' : 'Add Repository'}
          </button>
        </div>
      </div>
    </div>
  );
}
