import type { ProviderAdapter } from './types.js';
import { claudeCodeAdapter } from './adapters/claude-code.js';
import { codexAdapter } from './adapters/codex.js';

const adapters = new Map<string, ProviderAdapter>();

// Register built-in adapters
adapters.set('claude-code', claudeCodeAdapter);
adapters.set('codex', codexAdapter);

export function getAdapter(slug: string): ProviderAdapter | undefined {
  return adapters.get(slug);
}

export function registerAdapter(adapter: ProviderAdapter): void {
  adapters.set(adapter.slug, adapter);
}

export function getAllAdapters(): ProviderAdapter[] {
  return [...adapters.values()];
}
