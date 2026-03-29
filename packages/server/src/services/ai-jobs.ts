import cron from 'node-cron';
import {
  getDb,
  getSessionById,
  getPromptsBySession,
  getUserProfile,
  upsertUserProfile,
  getUserPromptCount,
  updateSessionAI,
  getUsersByTeam,
  listTeams,
  createTeamPulse,
  getAllUserProfiles,
} from './db.js';
import { runClaude, isClaudeAvailable } from './claude-ai.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Job Queue (simple, in-memory)
// ---------------------------------------------------------------------------

const jobQueue: Array<{ name: string; fn: () => Promise<void> }> = [];
let processing = false;

export function enqueueJob(name: string, fn: () => Promise<void>): void {
  console.log(`[ai-jobs] queued: ${name}`);
  jobQueue.push({ name, fn });
  processNext();
}

async function processNext(): Promise<void> {
  if (processing || jobQueue.length === 0) return;
  processing = true;
  const job = jobQueue.shift()!;
  console.log(`[ai-jobs] processing: ${job.name}`);
  try {
    await job.fn();
    console.log(`[ai-jobs] completed: ${job.name}`);
  } catch (e: any) {
    console.error(`[ai-jobs] failed: ${job.name}:`, e.message);
  }
  processing = false;
  if (jobQueue.length > 0) setTimeout(processNext, 1000); // 1s delay between jobs
}

// ---------------------------------------------------------------------------
// Session Intelligence
// ---------------------------------------------------------------------------

const SessionAnalysisSchema = z.object({
  summary: z.string(),
  categories: z.array(z.string()),
  productivity_score: z.number().min(0).max(100),
  key_actions: z.array(z.string()),
  tools_summary: z.string(),
});

export function queueSessionAnalysis(sessionId: string, userId: string): void {
  enqueueJob(`session-analysis:${sessionId}`, async () => {
    await analyzeSession(sessionId, userId);
  });
}

async function analyzeSession(sessionId: string, userId: string): Promise<void> {
  const available = await isClaudeAvailable();
  if (!available) return;

  const session = getSessionById(sessionId);
  if (!session) return;
  if (session.ai_analyzed_at) return; // already analyzed

  const prompts = getPromptsBySession(sessionId);
  if (prompts.length < 2) return; // not worth analyzing

  // Get tool events for this session
  const db = getDb();
  const tools = db.prepare(
    `SELECT tool_name, success, COUNT(*) as count FROM tool_events WHERE session_id = ? GROUP BY tool_name, success`
  ).all(sessionId) as any[];

  const duration = session.ended_at
    ? Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000)
    : 0;

  const toolSummary = tools.map(t => `${t.tool_name}(${t.count}${t.success === 0 ? ' failed' : ''})`).join(', ');

  const promptList = prompts
    .map((p, i) => `${i + 1}. ${p.prompt?.slice(0, 200) || '(empty)'}`)
    .join('\n');

  const { data } = await runClaude({
    prompt: `Analyze this Claude Code session and return JSON.

Session: project="${session.cwd || 'unknown'}", ${duration}min, ${prompts.length} prompts, ${session.total_credits} credits, model: ${session.model}

Prompts:
${promptList}

Tools used: ${toolSummary || 'none'}

Return JSON with these exact keys:
- "summary": string (1-2 sentences, what was accomplished)
- "categories": string[] (e.g. ["debugging", "feature-dev", "refactoring"])
- "productivity_score": number 0-100 (0=idle chat, 100=highly productive coding)
- "key_actions": string[] (specific things done, e.g. ["Fixed auth bug", "Added unit tests"])
- "tools_summary": string (1 sentence about tool usage patterns)`,
    systemPrompt: 'You are a JSON API analyzing developer sessions. Return ONLY valid JSON, no markdown.',
    schema: SessionAnalysisSchema,
    timeout: 60000,
  });

  updateSessionAI(sessionId, {
    ai_summary: data.summary,
    ai_categories: JSON.stringify(data.categories),
    ai_productivity_score: data.productivity_score,
    ai_key_actions: JSON.stringify(data.key_actions),
    ai_tools_summary: data.tools_summary,
  });
}

// ---------------------------------------------------------------------------
// Developer Profile Update
// ---------------------------------------------------------------------------

const DeveloperProfileSchema = z.object({
  role_estimate: z.string(),
  primary_languages: z.array(z.string()),
  current_focus: z.string(),
  work_patterns: z.object({
    peak_hours: z.string(),
    avg_session_length: z.string(),
    preferred_model: z.string(),
    session_frequency: z.string(),
  }),
  strengths: z.array(z.string()),
  growth_areas: z.array(z.string()),
  productivity: z.object({
    score: z.number(),
    trend: z.enum(['improving', 'stable', 'declining']),
    prompts_per_day_avg: z.number(),
    tool_use_ratio: z.number(),
  }),
  behavioral_notes: z.string(),
  this_week: z.string(),
  last_week: z.string(),
  flags: z.array(z.string()),
});

export async function updateUserProfile(userId: string): Promise<void> {
  const available = await isClaudeAvailable();
  if (!available) return;

  const currentProfile = getUserProfile(userId);
  const currentPromptCount = getUserPromptCount(userId);

  // Skip if no new prompts
  if (currentProfile && currentProfile.prompt_count_at_update >= currentPromptCount) return;

  const db = getDb();
  const since = currentProfile?.updated_at || new Date(0).toISOString();

  // Get new prompts since last update
  const newPrompts = db.prepare(
    `SELECT p.prompt, p.model, p.created_at FROM prompts p WHERE p.user_id = ? AND p.created_at > ? AND p.blocked = 0 AND p.prompt IS NOT NULL ORDER BY p.created_at DESC LIMIT 100`
  ).all(userId, since) as any[];

  if (newPrompts.length === 0) return;

  // Get recent session summaries
  const recentSessions = db.prepare(
    `SELECT model, cwd, prompt_count, total_credits, ai_summary, ai_productivity_score, started_at, ended_at FROM sessions WHERE user_id = ? AND started_at > ? ORDER BY started_at DESC LIMIT 20`
  ).all(userId, since) as any[];

  const previousProfile = currentProfile?.profile || 'No previous profile — this is the first analysis.';

  const sessionSummaries = recentSessions
    .map((s: any, i: number) => `${i + 1}. ${s.cwd || 'unknown'} (${s.prompt_count} prompts, ${s.total_credits} credits, model: ${s.model})${s.ai_summary ? ` — ${s.ai_summary}` : ''}`)
    .join('\n');

  const promptSamples = newPrompts
    .slice(0, 30)
    .map((p: any, i: number) => `${i + 1}. [${p.model}] ${p.prompt.slice(0, 150)}`)
    .join('\n');

  const { data } = await runClaude({
    prompt: `You are maintaining a developer behavior profile that evolves over time.

PREVIOUS PROFILE:
${previousProfile}

NEW ACTIVITY SINCE LAST UPDATE:
- ${newPrompts.length} new prompts across ${recentSessions.length} sessions

Sessions:
${sessionSummaries || 'No session data'}

Sample recent prompts:
${promptSamples}

Update the developer profile. Preserve historical observations. Add new insights. Update trends.

Return JSON with these exact keys:
- "role_estimate": string
- "primary_languages": string[]
- "current_focus": string
- "work_patterns": {"peak_hours": string, "avg_session_length": string, "preferred_model": string, "session_frequency": string}
- "strengths": string[]
- "growth_areas": string[]
- "productivity": {"score": number 0-100, "trend": "improving"|"stable"|"declining", "prompts_per_day_avg": number, "tool_use_ratio": number 0-1}
- "behavioral_notes": string
- "this_week": string
- "last_week": string
- "flags": string[]`,
    systemPrompt: 'You are a JSON API building developer behavioral profiles. Return ONLY valid JSON, no markdown.',
    schema: DeveloperProfileSchema,
    timeout: 60000,
  });

  upsertUserProfile({
    user_id: userId,
    profile: JSON.stringify(data),
    prompt_count_at_update: currentPromptCount,
  });

  console.log(`[ai-jobs] profile updated for user ${userId} (v${(currentProfile?.version || 0) + 1})`);
}

// ---------------------------------------------------------------------------
// Team Pulse
// ---------------------------------------------------------------------------

const TeamPulseSchema = z.object({
  headline: z.string(),
  active_summary: z.string(),
  shipping: z.array(z.object({ user: z.string(), work: z.string() })),
  needs_attention: z.array(z.object({ user: z.string(), issue: z.string() })),
  cost_insight: z.string(),
  trend: z.string(),
  recommendations: z.array(z.string()),
});

export async function generateTeamPulse(teamId: string): Promise<void> {
  const available = await isClaudeAvailable();
  if (!available) return;

  const users = getUsersByTeam(teamId);
  const profiles = getAllUserProfiles(teamId);
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const userSummaries = users.map(u => {
    const profile = profiles.find(p => p.user_id === u.id);
    let profileData: any = {};
    try { if (profile) profileData = JSON.parse(profile.profile); } catch {}

    const todayStats = db.prepare(
      `SELECT COUNT(*) as prompts, COALESCE(SUM(credit_cost), 0) as credits FROM prompts WHERE user_id = ? AND date(created_at) = ? AND blocked = 0`
    ).get(u.id, today) as any;

    return `- ${u.name}: ${profileData.role_estimate || 'unknown role'}, productivity ${profileData.productivity?.score || '?'}/100 (${profileData.productivity?.trend || '?'}), focus: ${profileData.current_focus || 'unknown'}, today: ${todayStats.prompts} prompts/${todayStats.credits} credits, flags: ${profileData.flags?.join(', ') || 'none'}`;
  }).join('\n');

  const totalToday = db.prepare(
    `SELECT COUNT(*) as prompts, COALESCE(SUM(credit_cost), 0) as credits FROM prompts WHERE user_id IN (SELECT id FROM users WHERE team_id = ?) AND date(created_at) = ? AND blocked = 0`
  ).get(teamId, today) as any;

  const { data } = await runClaude({
    prompt: `Generate a team executive briefing. Be concise — the reader has 30 seconds.

TEAM: ${users.length} developers

USER PROFILES:
${userSummaries}

TODAY'S TOTALS: ${totalToday.prompts} prompts, ${totalToday.credits} credits

Return JSON with these exact keys:
- "headline": string (one sentence team status)
- "active_summary": string (who's active, who's not)
- "shipping": [{"user": "name", "work": "description"}]
- "needs_attention": [{"user": "name", "issue": "description"}]
- "cost_insight": string (1-2 sentences on credit usage)
- "trend": string (1 sentence on team direction)
- "recommendations": string[] (actionable suggestions)`,
    systemPrompt: 'You are a JSON API generating executive briefings. Return ONLY valid JSON, no markdown.',
    schema: TeamPulseSchema,
    timeout: 60000,
  });

  createTeamPulse({ team_id: teamId, pulse: JSON.stringify(data) });
  console.log(`[ai-jobs] team pulse generated for team ${teamId}`);
}

// ---------------------------------------------------------------------------
// Cron Jobs
// ---------------------------------------------------------------------------

export function startAICrons(): () => void {
  // Update profiles every 2 hours
  const profileCron = cron.schedule('0 */2 * * *', async () => {
    console.log('[ai-jobs] running profile update cron');
    const teams = listTeams();
    for (const team of teams) {
      const users = getUsersByTeam(team.id);
      for (const user of users) {
        if (user.status !== 'active') continue;
        try {
          await updateUserProfile(user.id);
        } catch (e: any) {
          console.error(`[ai-jobs] profile update failed for ${user.name}:`, e.message);
        }
      }
    }
  });

  // Daily team pulse at 9 AM
  const pulseCron = cron.schedule('0 9 * * *', async () => {
    console.log('[ai-jobs] running daily team pulse');
    const teams = listTeams();
    for (const team of teams) {
      try {
        await generateTeamPulse(team.id);
      } catch (e: any) {
        console.error(`[ai-jobs] team pulse failed for ${team.name}:`, e.message);
      }
    }
  });

  return () => {
    profileCron.stop();
    pulseCron.stop();
  };
}
