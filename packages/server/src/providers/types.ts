import type { InferSelectModel } from 'drizzle-orm';
import type { users } from '../db/schema/index.js';

export type UserRow = InferSelectModel<typeof users>;

// ---------------------------------------------------------------------------
// Provider capabilities — what each provider supports
// ---------------------------------------------------------------------------

export interface ProviderCapabilities {
  hooks: boolean;
  blocking: boolean;
  credentials: boolean;
  usagePolling: boolean;
  localFiles: boolean;
  enforcedMode: boolean;
}

// ---------------------------------------------------------------------------
// Normalized event types — provider-agnostic shapes
// ---------------------------------------------------------------------------

export interface NormalizedSessionStart {
  sessionId: string;
  model: string;
  source: string;
  cwd?: string;
  cliVersion?: string;
  modelProvider?: string;
  reasoningEffort?: string;
  subscriptionEmail?: string;
  subscriptionType?: string;
  orgName?: string;
  accountId?: string;
  orgId?: string;
  authProvider?: string;
  hostname?: string;
  platform?: string;
  subscriptionActiveStart?: string;
  subscriptionActiveUntil?: string;
}

export interface NormalizedPrompt {
  sessionId: string;
  prompt?: string;
  model?: string;
  cwd?: string;
  turnId?: string;
}

export interface NormalizedStop {
  sessionId: string;
  lastAssistantMessage?: string;
  model?: string;
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  quotaPlanType?: string;
  quotaPrimaryUsedPercent?: number;
  quotaPrimaryWindowMinutes?: number;
  quotaPrimaryResetsAt?: number;
  quotaSecondaryUsedPercent?: number;
  quotaSecondaryWindowMinutes?: number;
  quotaSecondaryResetsAt?: number;
}

// ---------------------------------------------------------------------------
// Provider adapter interface
// ---------------------------------------------------------------------------

export interface ProviderAdapter {
  slug: string;
  name: string;
  defaultModel: string;
  capabilities: ProviderCapabilities;

  // Normalization — only for high-value events
  normalizeSessionStart(raw: unknown): NormalizedSessionStart;
  normalizePrompt(raw: unknown): NormalizedPrompt;
  normalizeStop(raw: unknown): NormalizedStop;

  // Response formatting — each provider has different response shapes
  formatSessionAllow(): object;
  formatSessionKill(): object;
  formatSessionPause(): object;
  formatPromptAllow(): object;
  formatPromptBlock(reason: string): object;
  formatPromptKill(): object;

  // Subscription normalization
  normalizeSubscriptionType(raw: string | undefined): string;

  // Optional provider-specific stop handling (e.g. Codex quota tracking)
  onStop?(data: NormalizedStop, userId: number): Promise<void>;
}
