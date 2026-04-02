export default function UsageBar({ value, max = 1, label, showPercentage = true, size = 'md' }: {
  value: number;
  max?: number;
  label?: string;
  showPercentage?: boolean;
  size?: 'sm' | 'md' | 'lg';
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = pct >= 90 ? 'text-red-700 bg-red-50' : pct >= 75 ? 'text-orange-700 bg-orange-50' : pct >= 50 ? 'text-yellow-700 bg-yellow-50' : 'text-green-700 bg-green-50';
  const heights = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' };

  return (
    <div>
      {label && <div className="text-xs text-gray-500 mb-1">{label}</div>}
      <div className="flex items-center gap-2">
        <div className={`flex-1 bg-gray-200 rounded-full ${heights[size]}`}>
          <div className={`${heights[size]} rounded-full transition-all duration-300 ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        {showPercentage && (
          <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${textColor}`}>{pct.toFixed(0)}%</span>
        )}
      </div>
    </div>
  );
}
