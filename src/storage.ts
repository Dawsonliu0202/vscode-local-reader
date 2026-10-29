import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import lockfile from 'proper-lockfile';
import { Book, Content, emptyState, isId, Position, Session, State } from './model';
import { Cancellation, cancelled, parseBook } from './content';

const LIMIT = 50 * 1024 * 1024;
const isMissing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
function validate(value: unknown): asserts value is State {
  const s = value as State;
  if (!s || s.schemaVersion !== 1 || !s.books || !s.sessions || !['sidebar', 'editor', 'panel'].includes(s.mode)) throw new Error('书架数据版本或结构无效');
  for (const [id, b] of Object.entries(s.books)) {
    if (!isId(id) || id !== b.id || !['epub', 'txt'].includes(b.format) || typeof b.displayTitle !== 'string' || !b.position || !Array.isArray(b.sectionIndex) || !Number.isFinite(b.totalLength)) throw new Error('书架条目损坏');
  }
  for (const session of Object.values(s.sessions)) if (!session || !isId(session.bookId) || typeof session.id !== 'string' || !session.days || Object.values(session.days).some(n => !Number.isFinite(n) || n < 0)) throw new Error('阅读记录损坏');
}

export class Storage {
  private queue: Promise<unknown> = Promise.resolve();
  recovered = false;
  constructor(readonly root: string) {}
  bookDir(id: string) { if (!isId(id)) throw new Error('书籍 ID 无效'); return path.join(this.root, 'books', id); }
  async init() { await mkdir(this.root, { recursive: true }); await mkdir(path.join(this.root, 'tmp'), { recursive: true }); return this.read(); }
  async read(): Promise<State> {
    let primaryMissing = false;
    try { const s: unknown = JSON.parse(await readFile(path.join(this.root, 'state.json'), 'utf8')); validate(s); return s; }
    catch (e) { primaryMissing = isMissing(e); }
    try {
      const backup: unknown = JSON.parse(await readFile(path.join(this.root, 'state.json.bak'), 'utf8')); validate(backup); this.recovered = true; return backup;
    } catch (e) {
      if (primaryMissing && isMissing(e)) return emptyState();
      throw new Error('书架数据及备份无法读取。请保留数据目录后检查或恢复备份，插件不会自动清空书架。');
    }
  }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const work = this.queue.then(async () => {
      await mkdir(this.root, { recursive: true });
      const release = await lockfile.lock(this.root, { retries: { retries: 20, minTimeout: 50, maxTimeout: 250 }, stale: 10000 });
      try {
        const state = await this.read(); const previous = JSON.stringify(state);
        const result = await change(state); validate(state);
        await this.atomic('state.json.bak', previous);
        await this.atomic('state.json', JSON.stringify(state)); return result;
      } finally { await release(); }
    });
    this.queue = work.catch(() => undefined); return work;
  }
  private async atomic(name: string, data: string) {
    const temp = path.join(this.root, `${name}.${randomUUID()}.tmp`);
    try { await writeFile(temp, data, 'utf8'); await rename(temp, path.join(this.root, name)); }
    finally { await rm(temp, { force: true }).catch(() => undefined); }
  }
  async importFile(file: string, encoding?: string, token?: Cancellation): Promise<{ book: Book; duplicate: boolean }> {
    const format = path.extname(file).slice(1).toLowerCase();
    if (format !== 'txt' && format !== 'epub') throw new Error('仅支持 TXT 与 EPUB 文件');
    const info = await stat(file); if (!info.isFile() || info.size > LIMIT) throw new Error('文件不是普通文件或超过 50 MiB 限制');
    const temp = path.join(this.root, 'tmp', randomUUID()); await mkdir(temp, { recursive: true });
    const sourcePath = path.join(temp, `source.${format}`);
    try {
      const hash = createHash('sha256'); let bytes = 0;
      await pipeline(createReadStream(file), new Transform({ transform(chunk: Buffer, _encoding, done) {
        try { cancelled(token); bytes += chunk.length; if (bytes > LIMIT) throw new Error('文件超过 50 MiB 限制'); hash.update(chunk); done(null, chunk); }
        catch (e) { done(e as Error); }
      } }), createWriteStream(sourcePath));
      const id = hash.digest('hex'); const existing = (await this.read()).books[id];
      if (existing) return { book: existing, duplicate: true };
      const parsed = await parseBook(sourcePath, format, id, path.basename(file, path.extname(file)), encoding, token);
      cancelled(token);
      await writeFile(path.join(temp, 'content.json'), JSON.stringify(parsed.content), 'utf8');
      const now = Date.now(); const c = parsed.content;
      const book: Book = { id, format, title: c.title, displayTitle: c.title, author: c.author, importedAt: now, encoding: parsed.encoding,
        lastReadAt: 0, position: { sectionId: c.sections[0].id, offset: 0, atEnd: false }, positionUpdatedAt: 0,
        totalLength: c.totalLength, sectionIndex: c.sections.map(s => ({ id: s.id, start: s.start, length: s.text.length })) };
      return await this.update(async s => {
        cancelled(token); if (s.books[id]) return { book: s.books[id], duplicate: true };
        await mkdir(path.join(this.root, 'books'), { recursive: true });
        // Only a validated hash can reach bookDir; any orphan from an interrupted import is replaceable.
        await rm(this.bookDir(id), { recursive: true, force: true });
        await rename(temp, this.bookDir(id)); s.books[id] = book;
        return { book, duplicate: false };
      });
    } finally { await rm(temp, { recursive: true, force: true }); }
  }
  async content(book: Book): Promise<Content> {
    const target = path.join(this.bookDir(book.id), 'content.json');
    try {
      const c = JSON.parse(await readFile(target, 'utf8')) as Content;
      if (c.version !== 1 || c.id !== book.id || !c.sections?.length || c.sections.some(s => typeof s.text !== 'string')) throw new Error('缓存无效');
      return c;
    } catch {
      try {
        const { content } = await parseBook(path.join(this.bookDir(book.id), `source.${book.format}`), book.format, book.id, book.title, book.encoding);
        const temp = `${target}.${randomUUID()}.tmp`;
        try { await writeFile(temp, JSON.stringify(content)); await rename(temp, target); } finally { await rm(temp, { force: true }); }
        return content;
      } catch { throw new Error('书籍副本缺失或无法读取，请移除该条目后重新导入原文件'); }
    }
  }
  async position(book: Book, position: Position, at: number) {
    await this.update(s => {
      const b = s.books[book.id]; if (!b || b.importedAt !== book.importedAt || b.positionUpdatedAt > at) return;
      const section = b.sectionIndex.find(s => s.id === position.sectionId);
      if (!section || !Number.isInteger(position.offset) || position.offset < 0 || position.offset > section.length) return;
      b.position = { ...position }; b.positionUpdatedAt = at; b.lastReadAt = at; s.lastBookId = b.id;
    });
  }
  async saveSession(session: Session, book: Book) {
    await this.update(s => {
      if (s.books[book.id]?.importedAt !== book.importedAt) return;
      const existing = s.sessions[session.id];
      if (existing?.endedAt && !session.endedAt) return;
      if (!existing || existing.checkpointAt <= session.checkpointAt) s.sessions[session.id] = session;
    });
  }
  async remove(id: string) {
    await this.update(async s => {
      // State is committed first. A leftover orphan is harmless if deleting the files later fails.
      delete s.books[id]; for (const [key, session] of Object.entries(s.sessions)) if (session.bookId === id) delete s.sessions[key];
      if (s.lastBookId === id) delete s.lastBookId;
    });
    // Serialize file deletion with import so reimport of the same bytes cannot be deleted accidentally.
    await this.update(async s => { if (!s.books[id]) await rm(this.bookDir(id), { recursive: true, force: true }); });
  }
  async flush() { await this.queue; }
}
