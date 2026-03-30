import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z, type ZodSchema } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

const execFileAsync = promisify(execFile);

function debug(msg: string): void {
  console.log(`[claude-ai] ${msg}`);
}

// Find claude CLI — may be in non-standard PATH inside Docker
let _claudeBin: string | null = null;

function getClaudeBin(): string {
  if (_claudeBin) return _claudeBin;

  debug('searching for claude CLI...');
  const { execFileSync } = require('node:child_process');
  const candidates = [
    'claude',
    '/root/.local/bin/claude',
    '/home/node/.local/bin/claude',
    '/usr/local/bin/claude',
  ];

  // Also check PATH expansions
  try {
    const which = execFileSync('which', ['claude'], { encoding: 'utf-8', timeout: 3000 }).trim();
    if (which) { debug(`'which claude' found: ${which}`); candidates.unshift(which); }
  } catch { debug(`'which claude' failed`); }

  for (const p of candidates) {
    try {
      execFileSync(p, ['--version'], { stdio: 'ignore', timeout: 5000 });
      debug(`found claude at: ${p}`);
      _claudeBin = p;
      return p;
    } catch {
      debug(`tried ${p} — not found`);
    }
  }

  debug('WARNING: claude CLI not found in any location');
  _claudeBin = 'claude'; // fallback
  return _claudeBin;
}

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
    const bin = getClaudeBin();

    const args = ['-p', '--output-format', 'json', '--max-turns', '3'];

    if (req.systemPrompt) {
      args.push('--system-prompt', req.systemPrompt);
    }

    // --json-schema removed: causes empty responses and tool_use issues
    // All prompts include explicit JSON format instructions instead

    args.push(req.prompt);

    const timeout = req.timeout ?? 30000;
    debug(`executing: ${bin} ${args.slice(0, 5).join(' ')}... (timeout=${timeout}ms)`);

    let stdout: string;
    try {
      const result = await execFileAsync(bin, args, {
        timeout,
        maxBuffer: 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (e: any) {
      debug(`execFile FAILED: ${e.message}`);
      if (e.stderr) debug(`stderr: ${String(e.stderr).slice(0, 500)}`);
      if (e.stdout) debug(`stdout (partial): ${String(e.stdout).slice(0, 500)}`);
      throw e;
    }

    const raw = stdout.trim();
    debug(`raw output length: ${raw.length} chars`);
    debug(`raw output (first 500): ${raw.slice(0, 500)}`);

    // Parse JSON — handle potential wrapper from --output-format json
    let parsed: unknown;
    try {
      const outer = JSON.parse(raw);
      debug(`outer JSON parsed OK, type=${outer?.type}, has result=${!!outer?.result}`);

      // Check for error responses
      if (outer?.subtype === 'error_max_turns' || outer?.is_error === true) {
        throw new Error(`Claude CLI error: ${outer.subtype || 'unknown'} (stop_reason: ${outer.stop_reason})`);
      }

      // claude -p --output-format json wraps in { type: "result", result: "..." }
      if (outer && typeof outer === 'object' && 'result' in outer && typeof outer.result === 'string') {
        let resultStr = outer.result;
        debug(`result field (first 300): ${resultStr.slice(0, 300)}`);

        // Strip markdown code fences: ```json\n{...}\n```
        resultStr = resultStr.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
        debug(`after stripping fences (first 300): ${resultStr.slice(0, 300)}`);

        try {
          parsed = JSON.parse(resultStr);
          debug(`result JSON parsed OK`);
        } catch (parseErr: any) {
          debug(`result JSON parse failed: ${parseErr.message}`);
          // Try extracting JSON object from the string
          const match = resultStr.match(/\{[\s\S]*\}/);
          if (match) {
            debug(`regex extracted JSON (${match[0].length} chars)`);
            parsed = JSON.parse(match[0]);
            debug(`regex JSON parsed OK`);
          } else {
            debug(`no JSON found in result string`);
            throw new Error(`Could not extract JSON from result: ${resultStr.slice(0, 200)}`);
          }
        }
      } else {
        debug(`outer is not a wrapper — using directly`);
        parsed = outer;
      }
    } catch (e: any) {
      debug(`outer JSON parse failed: ${e.message}`);
      // If outer JSON parse fails, try to extract JSON from raw text
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        debug(`fallback regex extracted JSON (${jsonMatch[0].length} chars)`);
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error(`Failed to parse AI response as JSON: ${raw.slice(0, 200)}`);
      }
    }

    debug(`parsed result: ${JSON.stringify(parsed).slice(0, 300)}`);

    // Validate against schema
    try {
      const data = req.schema.parse(parsed);
      debug(`zod validation passed`);
      return { data, raw, durationMs: Date.now() - start };
    } catch (zodErr: any) {
      debug(`zod validation FAILED: ${JSON.stringify(zodErr.issues)}`);
      debug(`parsed was: ${JSON.stringify(parsed).slice(0, 500)}`);
      throw zodErr;
    }
  });
}

/**
 * Check if claude CLI is available.
 */
export async function isClaudeAvailable(): Promise<boolean> {
  const bin = getClaudeBin();
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 5000 });
    debug(`isClaudeAvailable: YES — ${bin} → ${stdout.trim()}`);
    return true;
  } catch (e: any) {
    debug(`isClaudeAvailable: NO — ${bin} failed: ${e.message}`);
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
    prompt: `Analyze these ${prompts.length} Claude Code prompts and provide a summary.

${promptList}

Respond with ONLY a JSON object (no markdown, no code fences, no explanation), with exactly these keys:
- "summary": string (1-3 sentence summary of the work done)
- "categories": string[] (e.g. ["coding", "debugging", "documentation"])
- "topics": string[] (specific topics discussed)
- "risk_level": "low" | "medium" | "high" (based on sensitivity of content)

Example response format:
{"summary":"Developer worked on...", "categories":["coding"], "topics":["auth system"], "risk_level":"low"}`,
    systemPrompt:
      'You are a JSON API. You analyze AI usage patterns. Respond with ONLY valid JSON, no markdown formatting, no explanation text. Just the raw JSON object.',
    schema: SummarySchema,
    timeout: 60000,
  });

  return data;
}
