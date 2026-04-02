import type {
  ProviderAdapter,
  ProviderCapabilities,
  NormalizedSessionStart,
  NormalizedPrompt,
  NormalizedStop,
} from '../types.js';
import { SessionStartEvent, UserPromptSubmitEvent, StopEvent } from '../../schemas/hook-events.js';
import { updateLastMessageModel } from '../../db/queries/messages.js';

const capabilities: ProviderCapabilities = {
  hooks: true,
  blocking: true,
  credentials: true,
  usagePolling: true,
  localFiles: true,
  enforcedMode: true,
};

function normalizeSubscriptionType(raw: string | undefined): string {
  const lower = String(raw || '').toLowerCase();
  if (lower.includes('max')) return 'max';
  return 'pro';
}

export const claudeCodeAdapter: ProviderAdapter = {
  slug: 'claude-code',
  name: 'Claude Code',
  defaultModel: 'sonnet',
  capabilities,

  normalizeSessionStart(raw: unknown): NormalizedSessionStart {
    const body = raw as Record<string, unknown>;
    const parsed = SessionStartEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    return {
      sessionId: String(data.session_id || ''),
      model: String(body.model || body.detected_model || 'sonnet'),
      source: 'claude-code',
      cwd: data.cwd as string | undefined,
      subscriptionEmail: body.subscription_email as string | undefined,
      subscriptionType: body.subscription_type as string | undefined,
      orgName: body.org_name as string | undefined,
      hostname: body.hostname as string | undefined,
      platform: body.platform as string | undefined,
    };
  },

  normalizePrompt(raw: unknown): NormalizedPrompt {
    const body = raw as Record<string, unknown>;
    const parsed = UserPromptSubmitEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    return {
      sessionId: String(data.session_id || ''),
      prompt: data.prompt as string | undefined,
      model: body.model as string | undefined,
      cwd: data.cwd as string | undefined,
    };
  },

  normalizeStop(raw: unknown): NormalizedStop {
    const body = raw as Record<string, unknown>;
    const parsed = StopEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    return {
      sessionId: String(data.session_id || ''),
      lastAssistantMessage: body.last_assistant_message as string | undefined,
    };
  },

  // -- Response formatting --

  formatSessionAllow() {
    return {};
  },

  formatSessionKill() {
    return { continue: false, stopReason: 'Account suspended by admin. Contact your team lead.' };
  },

  formatSessionPause() {
    return { continue: false, stopReason: 'Account paused by admin. Contact your team lead.' };
  },

  formatPromptAllow() {
    return {};
  },

  formatPromptBlock(reason: string) {
    return { decision: 'block', reason };
  },

  formatPromptKill() {
    return { decision: 'block', reason: 'Account suspended.' };
  },

  normalizeSubscriptionType,

  // CC stop: just stamp the model on the latest message
  async onStop(data: NormalizedStop, _userId: number) {
    // Model is resolved in the pipeline and passed via data.model
    // We just need to update the last message's model
    if (data.sessionId && data.model) {
      await updateLastMessageModel(data.sessionId, data.model);
    }
  },
};
