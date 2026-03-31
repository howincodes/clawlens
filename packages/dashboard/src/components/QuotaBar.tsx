interface QuotaBarProps {
  percent: number
  label: string
  resetText: string
}

export function QuotaBar({ percent, label, resetText }: QuotaBarProps) {
  const color = percent < 50 ? 'bg-green-500' : percent < 80 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{percent.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
      <div className="text-[10px] text-muted-foreground">{resetText}</div>
    </div>
  )
}
