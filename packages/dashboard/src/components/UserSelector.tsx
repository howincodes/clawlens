import { useState, useEffect } from 'react';
import { getUsers } from '../lib/api';

export default function UserSelector({ value, onChange, placeholder = 'Select user', allowAll = false }: {
  value: number | null;
  onChange: (userId: number | null) => void;
  placeholder?: string;
  allowAll?: boolean;
}) {
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    getUsers().then(setUsers).catch(() => {});
  }, []);

  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value ? Number(e.target.value) : null)}
      className="border rounded-lg px-3 py-2 text-sm bg-white"
    >
      {allowAll && <option value="">{placeholder}</option>}
      {!allowAll && !value && <option value="">{placeholder}</option>}
      {users.map(u => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </select>
  );
}
