import { describe, it, expect } from 'vitest';
import { SummarySchema } from '../src/services/claude-ai.js';
import { isClaudeAvailable } from '../src/services/claude-ai.js';

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------

describe('claude-ai', () => {
  describe('SummarySchema', () => {
    it('validates correct data', () => {
      const data = {
        summary: 'Test summary of team activity',
        categories: ['coding', 'debugging'],
        topics: ['auth', 'api'],
        risk_level: 'low' as const,
      };
      const result = SummarySchema.parse(data);
      expect(result.summary).toBe('Test summary of team activity');
      expect(result.categories).toEqual(['coding', 'debugging']);
      expect(result.topics).toEqual(['auth', 'api']);
      expect(result.risk_level).toBe('low');
    });

    it('validates all risk levels', () => {
      for (const level of ['low', 'medium', 'high'] as const) {
        const data = {
          summary: 'Test',
          categories: [],
          topics: [],
          risk_level: level,
        };
        expect(() => SummarySchema.parse(data)).not.toThrow();
      }
    });

    it('rejects invalid risk_level', () => {
      const data = {
        summary: 'Test',
        categories: [],
        topics: [],
        risk_level: 'extreme',
      };
      expect(() => SummarySchema.parse(data)).toThrow();
    });

    it('rejects missing summary field', () => {
      const data = {
        categories: ['test'],
        topics: ['test'],
        risk_level: 'low',
      };
      expect(() => SummarySchema.parse(data)).toThrow();
    });

    it('rejects non-array categories', () => {
      const data = {
        summary: 'Test',
        categories: 'not-an-array',
        topics: [],
        risk_level: 'low',
      };
      expect(() => SummarySchema.parse(data)).toThrow();
    });

    it('accepts empty arrays for categories and topics', () => {
      const data = {
        summary: 'Minimal summary',
        categories: [],
        topics: [],
        risk_level: 'low' as const,
      };
      const result = SummarySchema.parse(data);
      expect(result.categories).toEqual([]);
      expect(result.topics).toEqual([]);
    });
  });

  describe('isClaudeAvailable', () => {
    it('returns a boolean', async () => {
      const result = await isClaudeAvailable();
      expect(typeof result).toBe('boolean');
    });
  });
});
