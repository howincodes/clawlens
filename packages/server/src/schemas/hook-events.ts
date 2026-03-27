import { z } from 'zod';

// ---------------------------------------------------------------------------
// Common base fields present in every hook event payload
// ---------------------------------------------------------------------------

export const HookBase = z.object({
  session_id: z.string(),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  hook_event_name: z.string(),
});

export type HookBasePayload = z.infer<typeof HookBase>;

// ---------------------------------------------------------------------------
// SessionStart
// ---------------------------------------------------------------------------

export const SessionStartEvent = HookBase.extend({
  hook_event_name: z.literal('SessionStart'),
  source: z.string().optional(),
  model: z.string().optional(),
});

export type SessionStartPayload = z.infer<typeof SessionStartEvent>;

// ---------------------------------------------------------------------------
// UserPromptSubmit
// ---------------------------------------------------------------------------

export const UserPromptSubmitEvent = HookBase.extend({
  hook_event_name: z.literal('UserPromptSubmit'),
  prompt: z.string().optional(),
});

export type UserPromptSubmitPayload = z.infer<typeof UserPromptSubmitEvent>;

// ---------------------------------------------------------------------------
// PreToolUse
// ---------------------------------------------------------------------------

export const PreToolUseEvent = HookBase.extend({
  hook_event_name: z.literal('PreToolUse'),
  tool_name: z.string(),
  tool_input: z.unknown().optional(),
});

export type PreToolUsePayload = z.infer<typeof PreToolUseEvent>;

// ---------------------------------------------------------------------------
// PostToolUse
// ---------------------------------------------------------------------------

export const PostToolUseEvent = HookBase.extend({
  hook_event_name: z.literal('PostToolUse'),
  tool_name: z.string(),
  tool_input: z.unknown().optional(),
  tool_response: z.unknown().optional(),
});

export type PostToolUsePayload = z.infer<typeof PostToolUseEvent>;

// ---------------------------------------------------------------------------
// PostToolUseFailure
// ---------------------------------------------------------------------------

export const PostToolUseFailureEvent = HookBase.extend({
  hook_event_name: z.literal('PostToolUseFailure'),
  tool_name: z.string(),
  error: z.string().optional(),
  error_details: z.unknown().optional(),
});

export type PostToolUseFailurePayload = z.infer<typeof PostToolUseFailureEvent>;

// ---------------------------------------------------------------------------
// Stop
// ---------------------------------------------------------------------------

export const StopEvent = HookBase.extend({
  hook_event_name: z.literal('Stop'),
  stop_hook_active: z.boolean().optional(),
  last_assistant_message: z.string().optional(),
});

export type StopPayload = z.infer<typeof StopEvent>;

// ---------------------------------------------------------------------------
// StopFailure
// ---------------------------------------------------------------------------

export const StopFailureEvent = HookBase.extend({
  hook_event_name: z.literal('StopFailure'),
  error: z.string().optional(),
  error_details: z.unknown().optional(),
});

export type StopFailurePayload = z.infer<typeof StopFailureEvent>;

// ---------------------------------------------------------------------------
// SessionEnd
// ---------------------------------------------------------------------------

export const SessionEndEvent = HookBase.extend({
  hook_event_name: z.literal('SessionEnd'),
  reason: z.string().optional(),
});

export type SessionEndPayload = z.infer<typeof SessionEndEvent>;

// ---------------------------------------------------------------------------
// SubagentStart
// ---------------------------------------------------------------------------

export const SubagentStartEvent = HookBase.extend({
  hook_event_name: z.literal('SubagentStart'),
  agent_id: z.string().optional(),
  agent_type: z.string().optional(),
});

export type SubagentStartPayload = z.infer<typeof SubagentStartEvent>;

// ---------------------------------------------------------------------------
// ConfigChange
// ---------------------------------------------------------------------------

export const ConfigChangeEvent = HookBase.extend({
  hook_event_name: z.literal('ConfigChange'),
  source: z.string().optional(),
  file_path: z.string().optional(),
});

export type ConfigChangePayload = z.infer<typeof ConfigChangeEvent>;

// ---------------------------------------------------------------------------
// FileChanged
// ---------------------------------------------------------------------------

export const FileChangedEvent = HookBase.extend({
  hook_event_name: z.literal('FileChanged'),
  file_path: z.string().optional(),
  event: z.string().optional(),
});

export type FileChangedPayload = z.infer<typeof FileChangedEvent>;

// ---------------------------------------------------------------------------
// Discriminated union of all hook events
// ---------------------------------------------------------------------------

export const HookEvent = z.discriminatedUnion('hook_event_name', [
  SessionStartEvent,
  UserPromptSubmitEvent,
  PreToolUseEvent,
  PostToolUseEvent,
  PostToolUseFailureEvent,
  StopEvent,
  StopFailureEvent,
  SessionEndEvent,
  SubagentStartEvent,
  ConfigChangeEvent,
  FileChangedEvent,
]);

export type HookEventPayload = z.infer<typeof HookEvent>;

// ---------------------------------------------------------------------------
// Hook event names as a const tuple for iteration / validation
// ---------------------------------------------------------------------------

export const HOOK_EVENT_NAMES = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'SessionEnd',
  'SubagentStart',
  'ConfigChange',
  'FileChanged',
] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];
