export default function WatchStatusIndicator({ status, showText = true }: { status: 'on' | 'off' | string; showText?: boolean }) {
  const isOn = status === 'on';
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-2.5 h-2.5 rounded-full ${isOn ? 'bg-green-500' : 'bg-gray-400'}`} />
      {showText && <span className={`text-sm ${isOn ? 'text-green-700' : 'text-gray-500'}`}>{isOn ? 'On Watch' : 'Off Watch'}</span>}
    </span>
  );
}
