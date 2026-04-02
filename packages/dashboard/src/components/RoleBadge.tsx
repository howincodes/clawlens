const roleColors: Record<string, string> = {
  Admin: 'bg-red-100 text-red-700 border-red-200',
  'Project Manager': 'bg-blue-100 text-blue-700 border-blue-200',
  Developer: 'bg-green-100 text-green-700 border-green-200',
  Viewer: 'bg-gray-100 text-gray-600 border-gray-200',
};

export default function RoleBadge({ role }: { role: string }) {
  const colors = roleColors[role] || 'bg-purple-100 text-purple-700 border-purple-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${colors}`}>
      {role}
    </span>
  );
}
