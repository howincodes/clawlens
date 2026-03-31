import { z } from 'zod';

// ---------------------------------------------------------------------------
// CodexSessionStart
// ---------------------------------------------------------------------------

export const CodexSessionStartEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('SessionStart').optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  source: z.string().optional(),
  transcript_path: z.string().optional(),
  subscription_email: z.string().optional(),
  plan_type: z.string().optional(),
  auth_provider: z.string().optional(),
  account_id: z.string().optional(),
  openai_user_id: z.string().optional(),
  subscription_active_start: z.string().optional(),
  subscription_active_until: z.string().optional(),
  org_id: z.string().optional(),
  org_title: z.string().optional(),
  cli_version: z.string().optional(),
  model_provider: z.string().optional(),
  reasoning_effort: z.string().optional(),
  hostname: z.string().optional(),
  platform: z.string().optional(),
});

export type CodexSessionStartPayload = z.infer<typeof CodexSessionStartEvent>;

// ---------------------------------------------------------------------------
// CodexPromptEvent (UserPromptSubmit)
// ---------------------------------------------------------------------------

export const CodexPromptEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('UserPromptSubmit').optional(),
  turn_id: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
});

export type CodexPromptPayload = z.infer<typeof CodexPromptEvent>;

// ---------------------------------------------------------------------------
// CodexPreToolUseEvent
// ---------------------------------------------------------------------------

export const CodexPreToolUseEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('PreToolUse').optional(),
  turn_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_use_id: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
});

export type CodexPreToolUsePayload = z.infer<typeof CodexPreToolUseEvent>;

// ---------------------------------------------------------------------------
// CodexPostToolUseEvent
// ---------------------------------------------------------------------------

export const CodexPostToolUseEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('PostToolUse').optional(),
  turn_id: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.unknown().optional(),
  tool_response: z.string().optional(),
  tool_use_id: z.string().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
});

export type CodexPostToolUsePayload = z.infer<typeof CodexPostToolUseEvent>;

// ---------------------------------------------------------------------------
// CodexStopEvent
// ---------------------------------------------------------------------------

export const CodexStopEvent = z.object({
  session_id: z.string(),
  hook_event_name: z.literal('Stop').optional(),
  turn_id: z.string().optional(),
  last_assistant_message: z.string().optional(),
  stop_hook_active: z.boolean().optional(),
  model: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  transcript_path: z.string().optional(),
  input_tokens: z.number().optional(),
  cached_tokens: z.number().optional(),
  output_tokens: z.number().optional(),
  reasoning_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  quota_primary_used_percent: z.number().optional(),
  quota_primary_window_minutes: z.number().optional(),
  quota_primary_resets_at: z.number().optional(),
  quota_secondary_used_percent: z.number().optional(),
  quota_secondary_window_minutes: z.number().optional(),
  quota_secondary_resets_at: z.number().optional(),
  quota_plan_type: z.string().optional(),
});

export type CodexStopPayload = z.infer<typeof CodexStopEvent>;

// ---------------------------------------------------------------------------
// Discriminated union of all Codex events
// ---------------------------------------------------------------------------

export const CodexEvent = z.discriminatedUnion('hook_event_name', [
  CodexSessionStartEvent,
  CodexPromptEvent,
  CodexPreToolUseEvent,
  CodexPostToolUseEvent,
  CodexStopEvent,
]);

export type CodexEventPayload = z.infer<typeof CodexEvent>;

// ---------------------------------------------------------------------------
// Codex event names as a const tuple for iteration / validation
// ---------------------------------------------------------------------------

export const CODEX_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
] as const;

export type CodexEventName = (typeof CODEX_EVENT_NAMES)[number];
