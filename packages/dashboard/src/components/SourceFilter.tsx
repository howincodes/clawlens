const SELECT_CLASS = 'flex h-9 w-40 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus:outline-none focus:ring-1 focus:ring-ring'

interface SourceFilterProps {
  value: string
  onChange: (value: string) => void
  className?: string
}

export function SourceFilter({ value, onChange, className }: SourceFilterProps) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`${SELECT_CLASS} ${className || ''}`}
    >
      <option value="">All Sources</option>
      <option value="claude_code">Claude Code</option>
      <option value="codex">Codex</option>
      <option value="antigravity">Antigravity</option>
    </select>
  )
}
