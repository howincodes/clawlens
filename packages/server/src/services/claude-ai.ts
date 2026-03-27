import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z, type ZodSchema } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

const execFileAsync = promisify(execFile);

interface ClaudeRequest<T> {
  prompt: string;
  systemPrompt?: string;
  schema: ZodSchema<T>;
  timeout?: number; // ms, default 30000
}

interface ClaudeResponse<T> {
  data: T;
  raw: string;
  durationMs: number;
}

// Simple queue to avoid overwhelming the CLI
let running = 0;
const MAX_CONCURRENT = 2;
const queue: Array<{
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  fn: () => Promise<any>;
}> = [];

async function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_CONCURRENT) {
    running++;
    try {
      return await fn();
    } finally {
      running--;
      processQueue();
    }
  }
  return new Promise((resolve, reject) => {
    queue.push({ resolve, reject, fn });
  });
}

function processQueue(): void {
  if (queue.length > 0 && running < MAX_CONCURRENT) {
    const item = queue.shift()!;
    running++;
    item
      .fn()
      .then(item.resolve)
      .catch(item.reject)
      .finally(() => {
        running--;
        processQueue();
      });
  }
}

/**
 * Run a structured AI query using claude -p CLI.
 * Returns validated, typed data.
 */
export async function runClaude<T>(req: ClaudeRequest<T>): Promise<ClaudeResponse<T>> {
  return enqueue(async () => {
    const start = Date.now();

    const args = ['-p', '--output-format', 'json', '--max-turns', '1'];

    if (req.systemPrompt) {
      args.push('--system-prompt', req.systemPrompt);
    }

    // Use --json-schema for validated output
    try {
      const jsonSchema = zodToJsonSchema(req.schema, { target: 'openApi3' });
      args.push('--json-schema', JSON.stringify(jsonSchema));
    } catch {
      // Fall back to asking for JSON in the prompt
      // (older Claude Code versions without --json-schema)
    }

    args.push(req.prompt);

    const timeout = req.timeout ?? 30000;

    const { stdout } = await execFileAsync('claude', args, {
      timeout,
      maxBuffer: 1024 * 1024, // 1MB
    });

    const raw = stdout.trim();

    // Parse JSON — handle potential wrapper from --output-format json
    let parsed: unknown;
    try {
      const outer = JSON.parse(raw);
      // claude -p --output-format json wraps in { result: "..." } or returns directly
      if (outer && typeof outer === 'object' && 'result' in outer && typeof outer.result === 'string') {
        try {
          parsed = JSON.parse(outer.result);
        } catch {
          parsed = outer.result;
        }
      } else {
        parsed = outer;
      }
    } catch {
      // If JSON parse fails, try to extract JSON from the text
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Failed to parse AI response as JSON: ${raw.slice(0, 200)}`);
      }
    }

    // Validate against schema
    const data = req.schema.parse(parsed);

    return { data, raw, durationMs: Date.now() - start };
  });
}

/**
 * Check if claude CLI is available.
 */
export async function isClaudeAvailable(): Promise<boolean> {
  try {
    await execFileAsync('claude', ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Pre-defined schemas for common operations

export const SummarySchema = z.object({
  summary: z.string(),
  categories: z.array(z.string()),
  topics: z.array(z.string()),
  risk_level: z.enum(['low', 'medium', 'high']),
});

export type SummaryResult = z.infer<typeof SummarySchema>;

/**
 * Generate a session/daily summary from prompts.
 */
export async function generateSummary(
  prompts: Array<{ prompt: string; model?: string; created_at: string }>,
): Promise<SummaryResult> {
  const promptList = prompts
    .map((p, i) => `${i + 1}. [${p.model || 'unknown'}] ${p.prompt?.slice(0, 200)}`)
    .join('\n');

  const { data } = await runClaude({
    prompt: `Analyze these ${prompts.length} Claude Code prompts and provide a summary:\n\n${promptList}`,
    systemPrompt:
      'You are analyzing AI usage patterns for a team analytics dashboard. Be concise. Focus on what work was done, key topics, and any concerning patterns.',
    schema: SummarySchema,
    timeout: 60000,
  });

  return data;
}
