import fs from 'fs';
import path from 'path';

/**
 * Shared byte-offset tracking for file-based watchers.
 * Persists offsets to a JSON file so restarts don't re-process old data.
 */

export function loadOffsets(offsetsPath: string): Map<string, number> {
  const offsets = new Map<string, number>();
  try {
    if (fs.existsSync(offsetsPath)) {
      const saved = JSON.parse(fs.readFileSync(offsetsPath, 'utf-8')) as Record<string, number>;
      for (const [k, v] of Object.entries(saved)) {
        offsets.set(k, v);
      }
    }
  } catch {}
  return offsets;
}

export function saveOffsets(offsetsPath: string, offsets: Map<string, number>): void {
  try {
    const dir = path.dirname(offsetsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, number> = {};
    for (const [k, v] of offsets.entries()) obj[k] = v;
    fs.writeFileSync(offsetsPath, JSON.stringify(obj));
  } catch {}
}

/**
 * Read new bytes from a file starting at the given byte offset.
 * Returns only complete lines (up to the last newline).
 * Returns null if no new complete lines.
 */
export function readNewBytes(filePath: string, offset: number): { content: string; newOffset: number } | null {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= offset) return null;

    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);

    const raw = buf.toString('utf-8');
    const lastNewline = raw.lastIndexOf('\n');
    if (lastNewline < 0) return null;

    const content = raw.slice(0, lastNewline + 1);
    const bytesConsumed = Buffer.byteLength(content, 'utf-8');
    return { content, newOffset: offset + bytesConsumed };
  } catch {
    return null;
  }
}

/**
 * Discover files matching a pattern in a directory tree.
 */
export function discoverFiles(baseDir: string, extension: string, maxDepth = 3): string[] {
  const files: string[] = [];
  if (!fs.existsSync(baseDir)) return files;

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(extension)) {
          files.push(fullPath);
        }
      }
    } catch {}
  }

  walk(baseDir, 0);
  return files;
}
