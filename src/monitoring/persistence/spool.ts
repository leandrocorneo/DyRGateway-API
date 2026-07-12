import { mkdir, readFile, rename, unlink, appendFile } from 'fs/promises';
import { dirname } from 'path';

export class MetricsSpool<T> {
  constructor(private readonly filePath: string) {}

  async append(items: T[]) {
    if (!items.length) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, items.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  }

  async replay(handler: (item: T) => Promise<void>) {
    let content = '';
    try { content = await readFile(this.filePath, 'utf8'); } catch { return; }
    if (!content.trim()) return;

    const processingPath = this.filePath + '.processing';
    await rename(this.filePath, processingPath);
    const failed: T[] = [];
    for (const line of content.split('\n').filter(Boolean)) {
      try { await handler(JSON.parse(line) as T); } catch { failed.push(JSON.parse(line) as T); }
    }
    try { await unlink(processingPath); } catch {}
    if (failed.length) await this.append(failed);
  }
}
