const SOURCE_CONFIG: Record<string, { label: string; className: string }> = {
  claude_code: { label: 'CC', className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
  codex: { label: 'Codex', className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300' },
  antigravity: { label: 'AG', className: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300' },
}

export function SourceBadge({ source }: { source: string }) {
  const config = SOURCE_CONFIG[source] || { label: source, className: 'bg-gray-100 text-gray-600' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-block ${config.className}`}>
      {config.label}
    </span>
  )
}
