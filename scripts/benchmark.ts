import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { Storage } from '../src/storage';
async function main() {
const dir = await mkdtemp(path.join(tmpdir(), 'local-reader-bench-'));
try {
  const file = path.join(dir, 'bench.txt'); const line = '这是用于性能验证的中文正文，包含常见标点与空格。\n';
  const text = '第一章 性能验证\n' + line.repeat(Math.floor((10 * 1024 * 1024 - 100) / Buffer.byteLength(line)));
  await writeFile(file, text); const storage = new Storage(path.join(dir, 'data')); await storage.init();
  const start = performance.now(); const { book } = await storage.importFile(file); const importMs = performance.now() - start;
  const open = performance.now(); const content = await storage.content(book); const cachedOpenMs = performance.now() - open;
  const report = { date: new Date().toISOString(), bytes: Buffer.byteLength(text), sections: content.sections.length, importMs: Math.round(importMs), cachedOpenMs: Math.round(cachedOpenMs), environment: { node: process.version, platform: process.platform, arch: process.arch } };
  await mkdir('.test-data', { recursive: true }); await writeFile('.test-data/benchmark.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally { await rm(dir, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
