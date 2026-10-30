import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat, open, readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import iconv from 'iconv-lite';
import { decodeTxt, txtContent, epubContent } from '../src/content';
import { absolutePosition, Book, chapterAt, chapters, clampPosition, emptyState, filterToc, localDate, positionAt, progress, readingRecords, sessionSeconds, statistics, validatePreferences } from '../src/model';
import { Storage } from '../src/storage';
import { Clock, Tracker } from '../src/tracker';
import { epubFixture } from './fixtures';
const id = 'a'.repeat(64);
test('阅读设置验证：默认跟随、左右布局与非法值隔离', () => {
  assert.deepEqual(validatePreferences({ fontSize: 0, lineHeight: 1.8, panelReaderSide: 'right', extra: 'ignored' }), { fontSize: 0, lineHeight: 1.8, panelReaderSide: 'right' });
  assert.equal(validatePreferences({ fontSize: 18, lineHeight: 2, panelReaderSide: 'left' }).panelReaderSide, 'left');
  for (const bad of [{ fontSize: 1, lineHeight: 1.8, panelReaderSide: 'right' }, { fontSize: 14, lineHeight: 9, panelReaderSide: 'left' }, { fontSize: 14, lineHeight: 1.8, panelReaderSide: 'other' }]) assert.throws(() => validatePreferences(bad));
  for (const fontSize of [0, 8, 40]) for (const lineHeight of [1.2, 3]) assert.equal(validatePreferences({ fontSize, lineHeight, panelReaderSide: 'right' }).fontSize, fontSize);
  for (const fontSize of [7, 41, 8.5, NaN, '20']) assert.throws(() => validatePreferences({ fontSize, lineHeight: 1.8, panelReaderSide: 'right' }));
});
test('目录筛选保留原始锚点与索引，支持长目录、同名、章号和全角查询', () => {
  const toc = Array.from({ length: 1000 }, (_, i) => ({ title: `第${i + 1}章 山路`, sectionId: `s${i}`, offset: i * 2 }));
  toc[720].title = toc[72].title;
  const matches = filterToc(toc, ' 第７３章 ');
  assert.deepEqual(matches.map(r => r.tocIndex), [72, 720]);
  assert.equal(matches[1].item, toc[720]); assert.equal(matches[1].item.sectionId, 's720');
  assert.ok(filterToc(toc, '721').some(r => r.tocIndex === 720));
  assert.equal(filterToc(toc, '不存在').length, 0); assert.equal(filterToc(toc, '').length, 1000);
  assert.equal(filterToc([{ title: 'EPILOGUE', sectionId: 'end', offset: 8 }], 'epilogue')[0].item.offset, 8);
  for (const [title, query] of [['第七十三章 风起', '第73章'], ['第两千零八回', '2008'], ['第十万零三章', '100003'], ['第一〇二章', '102']]) {
    assert.equal(filterToc([{ title, sectionId: 'chinese', offset: 4 }], query)[0]?.item.sectionId, 'chinese');
  }
});
async function temp(t: any) { const dir = await mkdtemp(path.join(tmpdir(), 'local-reader-test-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
function book(): Book {
  const c = txtContent(id, '测试书', '第一章 开篇\n' + '正文内容。\n'.repeat(50) + '\n第二章 继续\n结束');
  return { id, title: c.title, displayTitle: c.title, author: '', format: 'txt', importedAt: 1000, lastReadAt: 0, position: { sectionId: c.sections[0].id, offset: 0, atEnd: false }, positionUpdatedAt: 0, totalLength: c.totalLength, sectionIndex: c.sections.map(s => ({ id: s.id, start: s.start, length: s.text.length })) };
}
class TestClock implements Clock {
  wallTime = +new Date(2026, 9, 29, 12); monoTime = 0;
  wall() { return this.wallTime; } mono() { return this.monoTime; }
  advance(ms: number) { this.wallTime += ms; this.monoTime += ms; }
}
function advance(clock: TestClock, tracker: Tracker, seconds: number) { for (let i = 0; i < seconds; i++) { clock.advance(1000); tracker.tick(); } }

test('TXT UTF-8/BOM/GB18030 编码、换行、章节与无章节回退', () => {
  const text = '第一章 开始\r\n中文😀\r第二章 结束\n正文';
  assert.equal(decodeTxt(Buffer.from('\uFEFF' + text)).text, text.replace(/\r\n?/g, '\n'));
  const decoded = decodeTxt(iconv.encode('第一章 开始\n中文书籍', 'gb18030')); assert.equal(decoded.encoding, 'gb18030'); assert.equal(decoded.needsPreview, true);
  assert.match(decoded.text, /中文书籍/);
  assert.equal(txtContent(id, '书名', decodeTxt(Buffer.from(text)).text).toc.length, 2);
  assert.equal(txtContent(id, '没有章节', '只有正文').toc[0].title, '正文');
  assert.throws(() => decodeTxt(Buffer.from([0xff]), 'utf-8'), /无法/); assert.throws(() => txtContent(id, '空', '\n '), /未找到/);
  assert.throws(() => decodeTxt(Buffer.from('a\0b')), /二进制/);
});
test('正文分块保持全文与 Unicode 边界，末尾与回翻进度', () => {
  const text = '前'.repeat(15999) + '😀' + '文'.repeat(20000);
  const c = txtContent(id, '长文', text); assert.equal(c.sections.map(s => s.text).join(''), text);
  assert.ok(c.sections.length > 2); assert.ok(c.sections.every(s => s.text.length <= 16000 && !/^[\uDC00-\uDFFF]/.test(s.text)));
  const p = clampPosition(c, { sectionId: c.sections[1].id, offset: 1 }); assert.equal(p.offset, 0);
  const b = book(); assert.equal(progress(b), 0); assert.equal(progress(b, { ...b.position, atEnd: true }), 100);
  assert.equal(progress(b, b.position), 0);
});
for (const version of [2, 3] as const) test(`EPUB ${version} spine 顺序、元数据、目录锚点与脚本剔除`, async t => {
  const dir = await temp(t); const file = path.join(dir, 'book.epub'); await writeFile(file, epubFixture(version));
  const c = await epubContent(file, id, 'fallback');
  assert.equal(c.title, '测试书 & 示例'); assert.equal(c.author, '作者甲'); assert.match(c.sections[0].text, /第一章/);
  assert.match(c.sections.at(-1)!.text, /第二章/); assert.equal(c.toc.length, 3);
  const mid = c.toc[1]; assert.match(c.sections.find(s => s.id === mid.sectionId)!.text.slice(mid.offset), /^第二段/);
  assert.ok(!c.sections.some(s => /DO_NOT_RENDER|evil/.test(s.text)));
});
test('EPUB 拒绝加密、固定版式、实体和越界条目，损坏文件失败', async t => {
  const dir = await temp(t); const file = path.join(dir, 'bad.epub');
  for (const options of [{ encrypted: true }, { fixed: true }, { unsafe: true }, { entity: true }, { oversized: true }]) { await writeFile(file, epubFixture(3, options)); await assert.rejects(epubContent(file, id, 'bad')); }
  await writeFile(file, 'not a zip'); await assert.rejects(epubContent(file, id, 'bad'), /损坏/);
});
test('取消解析不会继续导入', async t => {
  const dir = await temp(t); const s = new Storage(path.join(dir, 'data')); await s.init();
  const file = path.join(dir, 'test.txt'); await writeFile(file, '正文');
  await assert.rejects(s.importFile(file, undefined, { isCancellationRequested: true }), /取消/);
  await writeFile(file, '正文'.repeat(1024 * 1024)); let checks = 0;
  await assert.rejects(s.importFile(file, undefined, { get isCancellationRequested() { return ++checks > 2; } }), /取消/);
  assert.deepEqual(await readdir(path.join(s.root, 'tmp')), []);
  const large = await open(file, 'w'); await large.truncate(50 * 1024 * 1024 + 1); await large.close();
  await assert.rejects(s.importFile(file), /50 MiB/);
  assert.equal(Object.keys((await s.read()).books).length, 0);
});
test('复制导入、重复、缓存重建、原文件移除、显示名与删除隔离', async t => {
  const dir = await temp(t); const s = new Storage(path.join(dir, 'data')); await s.init();
  const file = path.join(dir, 'book.txt'); await writeFile(file, '第一章 内容\n这是测试文本。');
  const first = await s.importFile(file); assert.equal(first.duplicate, false); const second = await s.importFile(file); assert.equal(second.duplicate, true);
  assert.equal(Object.keys((await s.read()).books).length, 1);
  await rm(file); await rm(path.join(s.bookDir(first.book.id), 'content.json')); assert.match((await s.content(first.book)).sections[0].text, /测试文本/);
  await s.update(state => { state.books[first.book.id].displayTitle = '新名字'; }); assert.equal((await s.read()).books[first.book.id].displayTitle, '新名字');
  await s.remove(first.book.id); assert.equal(Object.keys((await s.read()).books).length, 0); await assert.rejects(stat(s.bookDir(first.book.id)));
});
test('状态损坏使用完整备份，两个副本损坏拒绝静默清空', async t => {
  const dir = await temp(t); const s = new Storage(dir); await s.init();
  await s.update(state => { state.books[id] = book(); }); await s.update(state => { state.books[id].displayTitle = '新'; });
  await writeFile(path.join(dir, 'state.json'), '{bad'); const restored = await s.read(); assert.equal(restored.books[id].displayTitle, '测试书'); assert.equal(s.recovered, true);
  await writeFile(path.join(dir, 'state.json.bak'), '{bad'); await assert.rejects(s.read(), /不会自动清空/);
});
test('多窗口锁内更新不丢失，同文件并行导入只有一条，删除后旧进度与会话不能复活', async t => {
  const dir = await temp(t); const a = new Storage(path.join(dir, 'data')), b = new Storage(path.join(dir, 'data')); await a.init();
  const file = path.join(dir, 'book.txt'); await writeFile(file, '正文内容');
  const [one, two] = await Promise.all([a.importFile(file), b.importFile(file)]); assert.equal(one.book.id, two.book.id); assert.notEqual(one.duplicate, two.duplicate);
  await Promise.all([a.update(s => { s.lastBookId = one.book.id; }), b.update(s => { s.mode = 'panel'; })]);
  assert.equal((await a.read()).lastBookId, one.book.id); assert.equal((await a.read()).mode, 'panel');
  await a.position(one.book, { ...one.book.position, offset: 2 }, 5000); await b.position(one.book, { ...one.book.position, offset: 1 }, 4000); assert.equal((await a.read()).books[one.book.id].position.offset, 2);
  const tracker = new Tracker(); tracker.start(one.book); const session = tracker.end()!; await a.remove(one.book.id);
  await b.position(one.book, one.book.position, Date.now()); await b.saveSession(session, one.book); assert.equal(Object.keys((await a.read()).books).length, 0); assert.equal(Object.keys((await a.read()).sessions).length, 0);
  assert.match(await readFile(file, 'utf8'), /正文/);
});
test('计时：120 秒空闲、恢复、失焦、隐藏与休眠不补记', () => {
  const clock = new TestClock(), tracker = new Tracker(clock); tracker.start(book()); tracker.setFocused(true); tracker.setVisible(true);
  advance(clock, tracker, 300); assert.equal(sessionSeconds(tracker.snapshot()!), 120);
  tracker.activity(); advance(clock, tracker, 10); assert.equal(sessionSeconds(tracker.snapshot()!), 130);
  tracker.setFocused(false); advance(clock, tracker, 20); tracker.setFocused(true); advance(clock, tracker, 5); assert.equal(sessionSeconds(tracker.snapshot()!), 135);
  tracker.setVisible(false); advance(clock, tracker, 20); assert.equal(sessionSeconds(tracker.snapshot()!), 135);
  tracker.setVisible(true); tracker.activity(); clock.advance(60000); tracker.tick(); assert.equal(sessionSeconds(tracker.snapshot()!), 135);
  advance(clock, tracker, 2); const end = tracker.end()!; assert.equal(sessionSeconds(end), 137); assert.ok(end.endedAt); assert.equal(tracker.snapshot(), undefined);
});
test('跨午夜分日，统计来源一致，不重复累计检查点', () => {
  const clock = new TestClock(); clock.wallTime = +new Date(2026, 9, 29, 23, 59, 58);
  const tracker = new Tracker(clock); const b = book(); tracker.start(b); tracker.setFocused(true); tracker.setVisible(true); advance(clock, tracker, 5);
  const session = tracker.snapshot()!; assert.equal(session.days['2026-10-29'], 2); assert.equal(session.days['2026-10-30'], 3);
  assert.deepEqual(tracker.snapshot()!.days, session.days);
  const state = emptyState(); state.books[id] = b; state.sessions[session.id] = session;
  const stats = statistics(state, clock.wall()); assert.equal(stats.total, 5); assert.equal(stats.today, 3); assert.equal(stats.perBook[id], 5); assert.equal(Object.keys(stats.days).length, 7); assert.equal(localDate(clock.wall()), '2026-10-30');
});
test('重新创建存储后恢复位置与会话；重复检查点和延迟快照不能覆盖已结束记录', async t => {
  const dir = await temp(t); const s = new Storage(dir); await s.init(); const b = book(); await s.update(state => { state.books[id] = b; });
  const position = { ...b.position, offset: 5 }; await s.position(b, position, Date.now());
  const clock = new TestClock(), tracker = new Tracker(clock); tracker.start(b); tracker.setVisible(true); tracker.setFocused(true); advance(clock, tracker, 3);
  const snapshot = tracker.snapshot()!; const ended = tracker.end()!;
  await s.saveSession(snapshot, b); await s.saveSession(snapshot, b); await s.saveSession(ended, b); await s.saveSession(snapshot, b);
  const reopened = await new Storage(dir).init(); assert.deepEqual(reopened.books[id].position, position); assert.equal(reopened.sessions[ended.id].endedAt, ended.endedAt); assert.equal(statistics(reopened).total, 3);
});
test('同书同日合并记录，保留累计秒数、首末进度；不同书和日期分开', () => {
  const state = emptyState(), b = book(), other = { ...book(), id: 'b'.repeat(64) }; state.books[b.id] = b; state.books[other.id] = other;
  const base = +new Date(2026, 9, 29, 10);
  for (let i = 2; i >= 0; i--) state.sessions[`s${i}`] = { id: `s${i}`, owner: 'test', bookId: b.id, startedAt: base + i * 60000, endedAt: base + i * 60000 + 10000, checkpointAt: base + i * 60000 + 10000, startPosition: { ...b.position, offset: i * 10 }, endPosition: { ...b.position, offset: (i + 1) * 10 }, days: { '2026-10-29': i + 5 } };
  state.sessions.other = { ...state.sessions.s0, id: 'other', bookId: other.id };
  const merged = readingRecords(state), first = merged.find(r => r.bookId === b.id)!;
  assert.equal(merged.length, 2); assert.equal(first.seconds, 18); assert.equal(first.startPosition.offset, 0); assert.equal(first.endPosition.offset, 30);
  assert.equal(first.progressExact, true);
  assert.equal(merged.reduce((n, r) => n + r.seconds, 0), statistics(state).total);
  state.sessions.overnight = { ...state.sessions.s0, id: 'overnight', startedAt: +new Date(2026, 9, 29, 23, 59, 50), endedAt: +new Date(2026, 9, 30, 0, 0, 20), checkpointAt: +new Date(2026, 9, 30, 0, 0, 20), days: { '2026-10-29': 10, '2026-10-30': 20 } };
  const days = readingRecords(state).filter(r => r.bookId === b.id); assert.equal(days.length, 2); assert.equal(days[0].date, '2026-10-30'); assert.equal(days[0].seconds, 20); assert.equal(days[1].seconds, 28);
  assert.ok(days.every(r => !r.progressExact), 'do not invent daily progress for cross-midnight sessions');
  assert.equal(Object.keys(state.sessions).length, 5, 'raw sessions are retained');
});
test('章节由目录边界确定，跨存储分块仍属同章，绝对位置正确处理 Unicode', () => {
  const text = '第一章 开始\n' + '正文😀。\n'.repeat(5000) + '第二章 结束\n最后一页';
  const c = txtContent(id, '长章节', text), list = chapters(c);
  assert.equal(list.length, 2); assert.ok(c.sections.length > 2);
  assert.equal(list[0].end, list[1].start); assert.equal(list[1].end, c.totalLength);
  assert.equal(chapterAt(c, positionAt(c, 20000)).index, 0); assert.equal(chapterAt(c, positionAt(c, list[1].start)).index, 1);
  const emoji = text.indexOf('😀'); assert.equal(absolutePosition(c, positionAt(c, emoji + 1)), emoji);
  assert.equal(positionAt(c, c.totalLength, true).atEnd, true);
});

test('当前目录项按正文锚点匹配，同名、重复锚点和目录顺序不影响定位', () => {
  const c = txtContent(id, '目录示例', '第一章 起点\n' + '长章节的正文。\n'.repeat(4000) + '第二章 终点\n最后一段。');
  const [first, second] = c.toc;
  c.toc = [{ ...second, title: '同名章节' }, { ...first, title: '卷一' }, { ...first, title: '同名章节' }, { title: '无效项', sectionId: 'missing', offset: 0 }];
  const list = chapters(c);
  assert.equal(list[0].tocIndex, 2); assert.equal(list[1].tocIndex, 0);
  assert.equal(chapterAt(c, positionAt(c, 20000)).tocIndex, 2, 'storage chunks remain in the same logical chapter');
  assert.equal(chapterAt(c, positionAt(c, list[1].start)).tocIndex, 0);
  assert.equal(chapterAt(c, positionAt(c, c.totalLength, true)).tocIndex, 0);
  c.toc = [{ ...first, offset: 4 }];
  assert.equal(chapterAt(c, positionAt(c, 0)).tocIndex, -1, 'unlisted front matter must not highlight an unrelated chapter');
});
