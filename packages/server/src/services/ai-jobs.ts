import cron from 'node-cron';
import {
  getSessionById,
  getPromptsBySession,
  getUserProfile,
  upsertUserProfile,
  getUserPromptCount,
  updateSessionAI,
  getAllUsers,
  getAllUserProfiles,
  createTeamPulse,
  getUserCreditUsage,
} from '../db/queries/index.js';
import { getDb } from '../db/index.js';
import { toolEvents, prompts, sessions } from '../db/schema/index.js';
import { eq, and, gte, sql, desc } from 'drizzle-orm';
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

export function queueSessionAnalysis(sessionId: string, userId: number): void {
  enqueueJob(`session-analysis:${sessionId}`, async () => {
    await analyzeSession(sessionId, userId);
  });
}

async function analyzeSession(sessionId: string, userId: number): Promise<void> {
  const available = await isClaudeAvailable();
  if (!available) return;

  const session = await getSessionById(sessionId);
  if (!session) return;
  if (session.aiAnalyzedAt) return; // already analyzed

  const sessionPrompts = await getPromptsBySession(sessionId);
  if (sessionPrompts.length < 2) return; // not worth analyzing

  // Get tool events for this session
  const db = getDb();
  const tools = await db
    .select({
      toolName: toolEvents.toolName,
      success: toolEvents.success,
      count: sql<number>`count(*)::int`,
    })
    .from(toolEvents)
    .where(eq(toolEvents.sessionId, sessionId))
    .groupBy(toolEvents.toolName, toolEvents.success);

  const duration = session.endedAt
    ? Math.round((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 60000)
    : 0;

  const toolSummary = tools.map(t => `${t.toolName}(${t.count}${t.success === false ? ' failed' : ''})`).join(', ');

  const promptList = sessionPrompts
    .map((p, i) => `${i + 1}. ${p.prompt?.slice(0, 200) || '(empty)'}`)
    .join('\n');

  const { data } = await runClaude({
    prompt: `Analyze this Claude Code session and return JSON.

Session: project="${session.cwd || 'unknown'}", ${duration}min, ${sessionPrompts.length} prompts, ${session.totalCredits} credits, model: ${session.model}

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

  await updateSessionAI(sessionId, {
    aiSummary: data.summary,
    aiCategories: JSON.stringify(data.categories),
    aiProductivityScore: data.productivity_score,
    aiKeyActions: JSON.stringify(data.key_actions),
    aiToolsSummary: data.tools_summary,
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

export async function updateUserProfile(userId: number): Promise<void> {
  const available = await isClaudeAvailable();
  if (!available) return;

  const currentProfile = await getUserProfile(userId);
  const currentPromptCount = await getUserPromptCount(userId);

  // Skip if no new prompts
  if (currentProfile && currentProfile.promptCountAtUpdate !== null && currentProfile.promptCountAtUpdate >= currentPromptCount) return;

  const db = getDb();
  const since = currentProfile?.updatedAt || new Date(0);

  // Get new prompts since last update
  const newPrompts = await db
    .select({
      prompt: prompts.prompt,
      model: prompts.model,
      createdAt: prompts.createdAt,
    })
    .from(prompts)
    .where(
      and(
        eq(prompts.userId, userId),
        gte(prompts.createdAt, since),
        eq(prompts.blocked, false),
        sql`${prompts.prompt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(prompts.createdAt))
    .limit(100);

  if (newPrompts.length === 0) return;

  // Get recent session summaries
  const recentSessions = await db
    .select({
      model: sessions.model,
      cwd: sessions.cwd,
      promptCount: sessions.promptCount,
      totalCredits: sessions.totalCredits,
      aiSummary: sessions.aiSummary,
      aiProductivityScore: sessions.aiProductivityScore,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        gte(sessions.startedAt, since),
      ),
    )
    .orderBy(desc(sessions.startedAt))
    .limit(20);

  const previousProfile = currentProfile?.profile || 'No previous profile — this is the first analysis.';

  const sessionSummaries = recentSessions
    .map((s, i) => `${i + 1}. ${s.cwd || 'unknown'} (${s.promptCount} prompts, ${s.totalCredits} credits, model: ${s.model})${s.aiSummary ? ` — ${s.aiSummary}` : ''}`)
    .join('\n');

  const promptSamples = newPrompts
    .slice(0, 30)
    .map((p, i) => `${i + 1}. [${p.model}] ${(p.prompt ?? '').slice(0, 150)}`)
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

  await upsertUserProfile({
    userId,
    profile: JSON.stringify(data),
    promptCountAtUpdate: currentPromptCount,
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

export async function generateTeamPulse(): Promise<void> {
  const available = await isClaudeAvailable();
  if (!available) return;

  const allUsers = await getAllUsers();
  const profiles = await getAllUserProfiles();
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const userSummaries = await Promise.all(allUsers.map(async (u) => {
    const profile = profiles.find(p => p.userId === u.id);
    let profileData: any = {};
    try { if (profile) profileData = JSON.parse(profile.profile); } catch {}

    const todayStart = new Date(today);
    const todayStats = await db
      .select({
        promptsCount: sql<number>`count(*)::int`,
        credits: sql<number>`coalesce(sum(${prompts.creditCost}), 0)::real`,
      })
      .from(prompts)
      .where(
        and(
          eq(prompts.userId, u.id),
          gte(prompts.createdAt, todayStart),
          eq(prompts.blocked, false),
        ),
      );

    const stats = todayStats[0] ?? { promptsCount: 0, credits: 0 };

    return `- ${u.name}: ${profileData.role_estimate || 'unknown role'}, productivity ${profileData.productivity?.score || '?'}/100 (${profileData.productivity?.trend || '?'}), focus: ${profileData.current_focus || 'unknown'}, today: ${stats.promptsCount} prompts/${stats.credits} credits, flags: ${profileData.flags?.join(', ') || 'none'}`;
  }));

  const todayStart = new Date(today);
  const totalToday = await db
    .select({
      promptsCount: sql<number>`count(*)::int`,
      credits: sql<number>`coalesce(sum(${prompts.creditCost}), 0)::real`,
    })
    .from(prompts)
    .where(
      and(
        gte(prompts.createdAt, todayStart),
        eq(prompts.blocked, false),
      ),
    );

  const totals = totalToday[0] ?? { promptsCount: 0, credits: 0 };

  const { data } = await runClaude({
    prompt: `Generate a team executive briefing. Be concise — the reader has 30 seconds.

TEAM: ${allUsers.length} developers

USER PROFILES:
${userSummaries.join('\n')}

TODAY'S TOTALS: ${totals.promptsCount} prompts, ${totals.credits} credits

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

  await createTeamPulse(JSON.stringify(data));
  console.log(`[ai-jobs] team pulse generated`);
}

// ---------------------------------------------------------------------------
// Cron Jobs
// ---------------------------------------------------------------------------

export function startAICrons(): () => void {
  // Update profiles every 2 hours
  const profileCron = cron.schedule('0 */2 * * *', async () => {
    console.log('[ai-jobs] running profile update cron');
    const allUsers = await getAllUsers();
    for (const user of allUsers) {
      if (user.status !== 'active') continue;
      try {
        await updateUserProfile(user.id);
      } catch (e: any) {
        console.error(`[ai-jobs] profile update failed for ${user.name}:`, e.message);
      }
    }
  });

  // Daily team pulse at 9 AM
  const pulseCron = cron.schedule('0 9 * * *', async () => {
    console.log('[ai-jobs] running daily team pulse');
    try {
      await generateTeamPulse();
    } catch (e: any) {
      console.error(`[ai-jobs] team pulse failed:`, e.message);
    }
  });

  return () => {
    profileCron.stop();
    pulseCron.stop();
  };
}
