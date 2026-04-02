import type {
  ProviderAdapter,
  ProviderCapabilities,
  NormalizedSessionStart,
  NormalizedPrompt,
  NormalizedStop,
} from '../types.js';
import { CodexSessionStartEvent, CodexPromptEvent, CodexStopEvent } from '../../schemas/codex-events.js';
import { updateLastMessageWithResponse } from '../../db/queries/messages.js';
import { upsertProviderQuota } from '../../db/queries/model-credits.js';

const capabilities: ProviderCapabilities = {
  hooks: true,
  blocking: true,
  credentials: false,
  usagePolling: false,
  localFiles: false,
  enforcedMode: true,
};

function normalizeSubscriptionType(raw: string | undefined): string {
  if (!raw) return 'pro';
  return raw.toLowerCase();
}

export const codexAdapter: ProviderAdapter = {
  slug: 'codex',
  name: 'Codex',
  defaultModel: 'gpt-5.4',
  capabilities,

  normalizeSessionStart(raw: unknown): NormalizedSessionStart {
    const body = raw as Record<string, unknown>;
    const parsed = CodexSessionStartEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    return {
      sessionId: String(data.session_id || ''),
      model: String(body.model || 'gpt-5.4'),
      source: 'codex',
      cwd: data.cwd as string | undefined,
      cliVersion: body.cli_version as string | undefined,
      modelProvider: body.model_provider as string | undefined,
      reasoningEffort: body.reasoning_effort as string | undefined,
      subscriptionEmail: body.subscription_email as string | undefined,
      subscriptionType: body.plan_type as string | undefined,
      orgName: body.org_title as string | undefined,
      accountId: body.account_id as string | undefined,
      orgId: body.org_id as string | undefined,
      authProvider: body.auth_provider as string | undefined,
      hostname: body.hostname as string | undefined,
      platform: body.platform as string | undefined,
      subscriptionActiveStart: body.subscription_active_start as string | undefined,
      subscriptionActiveUntil: body.subscription_active_until as string | undefined,
    };
  },

  normalizePrompt(raw: unknown): NormalizedPrompt {
    const body = raw as Record<string, unknown>;
    const parsed = CodexPromptEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    return {
      sessionId: String(data.session_id || ''),
      prompt: data.prompt as string | undefined,
      model: body.model as string | undefined,
      cwd: data.cwd as string | undefined,
      turnId: body.turn_id as string | undefined,
    };
  },

  normalizeStop(raw: unknown): NormalizedStop {
    const body = raw as Record<string, unknown>;
    const parsed = CodexStopEvent.safeParse(body);
    const data = parsed.success ? parsed.data : body;

    return {
      sessionId: String(data.session_id || ''),
      lastAssistantMessage: body.last_assistant_message as string | undefined,
      inputTokens: body.input_tokens as number | undefined,
      cachedTokens: body.cached_tokens as number | undefined,
      outputTokens: body.output_tokens as number | undefined,
      reasoningTokens: body.reasoning_tokens as number | undefined,
      quotaPlanType: body.quota_plan_type as string | undefined,
      quotaPrimaryUsedPercent: body.quota_primary_used_percent as number | undefined,
      quotaPrimaryWindowMinutes: body.quota_primary_window_minutes as number | undefined,
      quotaPrimaryResetsAt: body.quota_primary_resets_at as number | undefined,
      quotaSecondaryUsedPercent: body.quota_secondary_used_percent as number | undefined,
      quotaSecondaryWindowMinutes: body.quota_secondary_window_minutes as number | undefined,
      quotaSecondaryResetsAt: body.quota_secondary_resets_at as number | undefined,
    };
  },

  // -- Response formatting --

  formatSessionAllow() {
    return {};
  },

  formatSessionKill() {
    return { decision: 'block', killed: true, hard: true };
  },

  formatSessionPause() {
    return { decision: 'block' };
  },

  formatPromptAllow() {
    return {};
  },

  formatPromptBlock(reason: string) {
    return { decision: 'block', reason };
  },

  formatPromptKill() {
    return { decision: 'block', killed: true, hard: true };
  },

  normalizeSubscriptionType,

  // Codex stop: update response + token counts, upsert quota windows
  async onStop(data: NormalizedStop, userId: number) {
    if (data.sessionId) {
      await updateLastMessageWithResponse(data.sessionId, 'codex', {
        response: data.lastAssistantMessage,
        model: data.model,
        inputTokens: data.inputTokens,
        cachedTokens: data.cachedTokens,
        outputTokens: data.outputTokens,
        reasoningTokens: data.reasoningTokens,
      });
    }

    if (data.quotaPrimaryUsedPercent != null) {
      await upsertProviderQuota({
        userId,
        source: 'codex',
        windowName: 'primary',
        planType: data.quotaPlanType,
        usedPercent: data.quotaPrimaryUsedPercent,
        windowMinutes: data.quotaPrimaryWindowMinutes,
        resetsAt: data.quotaPrimaryResetsAt,
      });
    }
    if (data.quotaSecondaryUsedPercent != null) {
      await upsertProviderQuota({
        userId,
        source: 'codex',
        windowName: 'secondary',
        planType: data.quotaPlanType,
        usedPercent: data.quotaSecondaryUsedPercent,
        windowMinutes: data.quotaSecondaryWindowMinutes,
        resetsAt: data.quotaSecondaryResetsAt,
      });
    }
  },
};
