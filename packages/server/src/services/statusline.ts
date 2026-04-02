/**
 * Generate statusline configuration for a user's Claude Code session.
 * This can be pushed to the client via WebSocket or returned by the status endpoint.
 */
export function generateStatuslineConfig(usage: {
  fiveHourUtilization: number;
  sevenDayUtilization: number;
  subscriptionEmail: string;
  watchStatus: string;
}) {
  const u5h = Math.round(usage.fiveHourUtilization * 100);
  const u7d = Math.round(usage.sevenDayUtilization * 100);

  // Generate a terminal-friendly status string
  const bar = generateBar(u5h);
  const status = usage.watchStatus === 'on' ? '\u25CF' : '\u25CB';

  return {
    text: `${status} ${bar} ${u5h}% (5h) | ${u7d}% (7d) | ${usage.subscriptionEmail.split('@')[0]}`,
    utilization5h: u5h,
    utilization7d: u7d,
  };
}

function generateBar(pct: number): string {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

export { generateBar };
