import { useState, useEffect } from 'react';
import { getProjects } from '../lib/api';

export default function ProjectSelector({ value, onChange, placeholder = 'Select project', allowAll = false }: {
  value: number | null;
  onChange: (projectId: number | null) => void;
  placeholder?: string;
  allowAll?: boolean;
}) {
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
  }, []);

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className="border rounded-lg px-3 py-2 text-sm bg-white"
    >
      {allowAll && <option value="">{placeholder}</option>}
      {!allowAll && !value && <option value="">{placeholder}</option>}
      {projects.map(p => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}
