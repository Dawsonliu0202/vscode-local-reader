import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { txtContent } from '../src/content';
import { absolutePosition, chapterAt, chapters, positionAt, type Position } from '../src/model';
const id = 'b'.repeat(64);
const content = txtContent(id, '示例书', '第一章 起点\n' + '这是用于阅读排版测试的正文，包含中文、标点和 emoji 😀。\n'.repeat(1500) + '第二章 继续\n' + '后一章的正文。\n'.repeat(100));
function reader(position: Position = positionAt(content, 0), mode = 'editor') {
  const chapter = chapterAt(content, position);
  return { type: 'reader', token: 'test-token', bookId: id, title: content.title, mode, position, absolutePosition: absolutePosition(content, position), chapter: { ...chapter, text: content.sections.map(s => s.text).join('').slice(chapter.start, chapter.end) }, toc: content.toc, progress: 0, settings: { fontSize: 15, editorFontSize: 15, lineHeight: 1.8, fontFamily: 'var(--vscode-font-family, sans-serif)' }, preferences: { fontSize: 0, lineHeight: 1.8, panelReaderSide: 'right' } };
}
async function dispatch(page: Page, data: unknown) { await page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data); }
async function ready(page: Page, chapter?: string) { await page.waitForFunction("document.querySelector('.page-counter') && /^\\d+ \\/ \\d+$/.test(document.querySelector('.page-counter').textContent) && document.querySelector('.page-flow').style.width === Math.floor(document.querySelector('.page-window').clientWidth) + 'px'" + (chapter ? ' && document.querySelector(\'.chapter-title\').textContent === ' + JSON.stringify(chapter) : '')); }
async function pageNumber(page: Page) { return String(await page.locator('.page-counter').textContent()).split(' / ').map(Number); }
async function chapterAction(page: Page, name: string) {
  if (!(await page.locator('.toolbar').getByRole('button', { name, exact: true }).isVisible())) await page.getByRole('button', { name: '操作菜单', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
}

test('长目录自动定位并高亮当前章节，支持同名章节、长章分块和切章后重新打开', async () => {
  const c = txtContent('d'.repeat(64), '目录定位示例', Array.from({ length: 1000 }, (_, i) => `第${i + 1}章 山路与微光\n` + '阅读正文，保持章节位置。\n'.repeat(i === 72 ? 1500 : 20)).join('\n'));
  c.toc.unshift({ ...c.toc[0], title: '卷一' });
  c.toc[1].title = c.toc[73].title;
  c.toc[501].title = '第五百零一章 溪流';
  const list = chapters(c), text = c.sections.map(s => s.text).join('');
  const target = list[72];
  const payload = (absolute: number, mode = 'panel') => {
    const position = positionAt(c, absolute), chapter = chapterAt(c, position);
    return { ...reader(), bookId: c.id, title: c.title, mode, position, absolutePosition: absolutePosition(c, position), chapter: { ...chapter, text: text.slice(chapter.start, chapter.end) }, toc: c.toc };
  };
  let current = payload(target.start + 18000);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 480, height: 600 } }); const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('postToHost', async (m: any) => {
      if (m.type === 'pagePosition') { current.position = positionAt(c, m.absolute, m.atEnd); current.absolutePosition = m.absolute; }
      if (m.type === 'jump') { current = payload(absolutePosition(c, m.position), current.mode); await dispatch(page, current); }
      if (m.type === 'action' && m.action === 'nextChapter') { current = payload(list[current.chapter.index + 1].start, current.mode); await dispatch(page, current); }
    });
    await page.setContent('<!DOCTYPE html><html lang="zh-CN"><body><div id="app"></div></body></html>');
    await page.evaluate("window.acquireVsCodeApi = function () { return { postMessage: function (m) { return window.postToHost(m); }, setState: function () {} }; }; document.documentElement.style.cssText = '--vscode-font-family: Segoe UI, Microsoft YaHei, sans-serif; --vscode-editor-background:#002b36; --vscode-foreground:#93a1a1; --vscode-menu-background:#00212b; --vscode-list-activeSelectionBackground:#073642; --vscode-list-activeSelectionForeground:#d9e2e3; --vscode-focusBorder:#2aa198';");
    await page.addStyleTag({ path: path.resolve('dist/webview.css') }); await page.addScriptTag({ path: path.resolve('dist/webview.js') });
    const selected = page.locator('#toc button[aria-current="location"]');
    const assertCurrent = async (tocIndex: number, centered = false) => {
      assert.equal(await selected.count(), 1);
      assert.equal(await selected.getAttribute('data-toc-index'), String(tocIndex));
      const item = (await selected.boundingBox())!, bounds = (await page.locator('.toc-list').boundingBox())!;
      assert.ok(item.y >= bounds.y && item.y + item.height <= bounds.y + bounds.height, 'current chapter is fully visible');
      if (centered) assert.ok(Math.abs(item.y + item.height / 2 - bounds.y - bounds.height / 2) < 4, 'middle chapters are centered');
      assert.equal(await page.locator('.toc-search').evaluate(e => document.activeElement === e), true);
      assert.equal(await page.evaluate('window.scrollY'), 0, 'only the directory scrolls');
      assert.notEqual(await selected.evaluate(e => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
    };
    for (const mode of ['sidebar', 'editor', 'panel']) {
      current = payload(target.start + 18000, mode); await dispatch(page, current); await ready(page);
      await page.getByRole('button', { name: '目录', exact: true }).click(); await assertCurrent(target.tocIndex, true);
      assert.equal(await selected.textContent(), target.title);
      const headerTop = (await page.locator('.toc-header').boundingBox())!.y;
      await page.locator('.toc-list').hover(); await page.mouse.wheel(0, -20000); await page.waitForFunction("document.querySelector('.toc-list').scrollTop === 0");
      assert.equal((await page.locator('.toc-header').boundingBox())!.y, headerTop, 'search and actions stay fixed');
      await page.keyboard.press('Escape'); await page.getByRole('button', { name: '目录', exact: true }).click(); await assertCurrent(target.tocIndex, true);
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: '目录', exact: true }).click();
    await page.getByRole('searchbox').fill(target.title);
    assert.equal(await page.locator('.toc-list button').count(), 2, 'same-name chapters retain both anchors');
    assert.equal(await selected.getAttribute('data-toc-index'), String(target.tocIndex));
    await page.keyboard.press('ArrowUp'); assert.equal(await page.locator('.toc-selected').getAttribute('data-toc-index'), '1');
    await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('.toc-selected').getAttribute('data-toc-index'), String(target.tocIndex));
    await page.getByRole('searchbox').fill('不存在的章节'); assert.equal(await selected.count(), 0);
    assert.match(await page.locator('.toc-empty').textContent() ?? '', /没有匹配的章节/);
    await page.getByRole('button', { name: '清空搜索', exact: true }).click(); await assertCurrent(target.tocIndex, true);
    await page.getByRole('searchbox').fill('999'); await page.getByRole('button', { name: '回到当前章', exact: true }).click(); await assertCurrent(target.tocIndex, true);
    assert.equal(await page.getByRole('searchbox').inputValue(), '');
    await page.getByRole('searchbox').fill('第501章'); assert.equal(await page.locator('.toc-list button').textContent(), '第五百零一章 溪流');
    await page.getByRole('searchbox').fill('第101章');
    await page.getByRole('searchbox').evaluate(e => {
      e.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: false }));
      e.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true }));
      e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, keyCode: 229 }));
    });
    assert.equal(await page.locator('#toc').count(), 1, 'IME candidate Enter does not jump');
    assert.equal(current.chapter.index, target.index);
    await page.keyboard.press('Enter'); await ready(page, list[100].title);
    current = payload(target.start + 18000); await dispatch(page, current); await ready(page);
    await page.getByRole('button', { name: '下一章', exact: true }).click(); await ready(page, list[73].title);
    await page.getByRole('button', { name: '目录', exact: true }).click(); await assertCurrent(list[73].tocIndex, true);
    const jump = list[100]; await page.locator('.toc-list button').nth(jump.tocIndex).click(); await ready(page, jump.title);
    await page.getByRole('button', { name: '目录', exact: true }).click(); await assertCurrent(jump.tocIndex, true);
    await mkdir('.test-data/screenshots', { recursive: true }); await page.screenshot({ path: '.test-data/screenshots/toc-current-v050.png' });
    for (const chapter of [list[0], list.at(-1)!]) {
      current = payload(chapter.start); await dispatch(page, current); await ready(page);
      await dispatch(page, { type: 'toc' }); await assertCurrent(chapter.tocIndex); await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('左右分区点击、分页阅读、滚轮禁用、章节导航、位置恢复与精简管理界面', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
    const errors: string[] = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
    const messages: any[] = []; let current = reader();
    await page.exposeFunction('postToHost', async (m: any) => {
      messages.push(m);
      if (m.type === 'pagePosition') { current.position = positionAt(content, m.absolute, m.atEnd); current.absolutePosition = m.absolute; }
      if (m.type === 'jump') { current = reader(m.position, current.mode); await dispatch(page, current); }
      if (m.type === 'chapterEdge' || m.type === 'action' && ['previousChapter', 'nextChapter'].includes(m.action)) {
        const direction = m.type === 'chapterEdge' ? m.direction : m.action === 'nextChapter' ? 1 : -1;
        const target = chapters(content)[chapterAt(content, current.position).index + direction];
        if (target) { current = reader(positionAt(content, m.type === 'chapterEdge' && direction < 0 ? target.end - 1 : target.start), current.mode); await dispatch(page, current); }
      }
    });
    await page.setContent('<!DOCTYPE html><html lang="zh-CN"><body><div id="app"></div></body></html>');
    await page.evaluate("window.acquireVsCodeApi = function () { return { postMessage: function (m) { return window.postToHost(m); }, setState: function () {} }; }; document.documentElement.style.setProperty('--vscode-font-family', 'Arial, sans-serif');");
    await page.addStyleTag({ path: path.resolve('dist/webview.css') }); await page.addScriptTag({ path: path.resolve('dist/webview.js') });
    await dispatch(page, current); await ready(page);
    assert.equal(await page.locator('.chapter-title').textContent(), '第一章 起点'); assert.equal(await page.locator('.book-name').textContent(), '示例书');
    const initial = await pageNumber(page); assert.equal(initial[0], 1); assert.ok(initial[1] > 3);
    assert.match(await page.locator('.viewport').evaluate(e => getComputedStyle(e).fontFamily), /Arial/);
    // Check real glyph geometry at each page boundary, including carried chunks:
    // adjacent absolute ranges must meet and boundary glyphs must be visible.
    const coverage = await page.evaluate(() => {
      const footer = document.querySelector<HTMLElement>('.page-counter')!;
      const count = Number(footer.textContent!.split(' / ')[1]); let previousEnd = 0;
      for (let i = 0; i < count; i++) {
        const start = Number(footer.dataset.pageStart), end = Number(footer.dataset.pageEnd);
        if (start !== previousEnd || end <= start) return `range gap on page ${i + 1}`;
        const flow = document.querySelector<HTMLElement>('.page-flow:not(.page-measure)')!, chunkStart = Number(flow.dataset.start), text = flow.textContent!;
        const node = flow.firstChild!, bounds = document.querySelector('.page-window')!.getBoundingClientRect();
        let first = start - chunkStart, last = end - chunkStart - 1;
        while (first < last && /\s/.test(text[first])) first++;
        while (last > first && /\s/.test(text[last])) last--;
        for (let at of [first, last]) {
          if (/[\uDC00-\uDFFF]/.test(text[at])) at--;
          const range = document.createRange(); range.setStart(node, at); range.setEnd(node, at + (text.codePointAt(at)! > 0xffff ? 2 : 1));
          const rect = range.getBoundingClientRect();
          if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) return `clipped boundary glyph on page ${i + 1}`;
        }
        previousEnd = end;
        if (i < count - 1) document.querySelector<HTMLButtonElement>('[data-page="next"]')!.click();
      }
      return previousEnd;
    });
    assert.equal(coverage, current.chapter.end, 'all pages cover the chapter without missing boundary text');
    current = reader(); await dispatch(page, current); await ready(page);
    const tap = async (fraction: number) => {
      const bounds = (await page.locator('.viewport').boundingBox())!;
      await page.mouse.click(bounds.x + bounds.width * fraction, bounds.y + bounds.height - 5);
    };
    for (const mode of ['sidebar', 'editor', 'panel']) {
      current = reader(undefined, mode); await dispatch(page, current); await ready(page);
      await tap(.1); assert.equal((await pageNumber(page))[0], 1, `${mode}: first page stays at start`);
      await tap(.9); assert.equal((await pageNumber(page))[0], 2, `${mode}: right zone advances once`);
      await tap(.5); assert.equal((await pageNumber(page))[0], 2, `${mode}: center does not turn pages`);
      await tap(.1); assert.equal((await pageNumber(page))[0], 1, `${mode}: left zone goes back once`);
    }
    current = reader(); await dispatch(page, current); await ready(page); await tap(.9);
    const selectionPoints = await page.evaluate(() => {
      const flow = document.querySelector<HTMLElement>('.page-flow:not(.page-measure)')!, node = flow.firstChild!;
      const at = Number(document.querySelector<HTMLElement>('.page-counter')!.dataset.pageStart) - Number(flow.dataset.start);
      const points = [];
      for (const offset of [at + 1, at + 7]) { const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1); const r = range.getBoundingClientRect(); points.push({ x: r.left + 1, y: r.top + r.height / 2 }); }
      return { start: points[0], end: points[1] };
    });
    await page.mouse.move(selectionPoints.start.x, selectionPoints.start.y); await page.mouse.down();
    await page.mouse.move(selectionPoints.end.x, selectionPoints.end.y, { steps: 5 }); await page.mouse.up();
    assert.equal((await pageNumber(page))[0], 2, 'dragging text must not turn a page');
    assert.ok(await page.evaluate('window.getSelection().toString().length > 0'));
    await tap(.1); assert.equal((await pageNumber(page))[0], 2, 'clearing an existing selection must not turn a page');
    const dragBounds = (await page.locator('.viewport').boundingBox())!;
    await page.mouse.move(dragBounds.x + dragBounds.width * .9, dragBounds.y + dragBounds.height - 3); await page.mouse.down();
    await page.mouse.move(dragBounds.x + dragBounds.width * .8, dragBounds.y + dragBounds.height - 3, { steps: 5 }); await page.mouse.up();
    assert.equal((await pageNumber(page))[0], 2, 'dragging blank space must not turn a page');
    await tap(.1); assert.equal((await pageNumber(page))[0], 1);
    await page.getByRole('button', { name: '操作菜单', exact: true }).click(); await tap(.9);
    assert.equal((await pageNumber(page))[0], 1, 'open menus suppress background page turns');
    await page.keyboard.press('Escape');
    await page.locator('.viewport').hover(); await page.mouse.wheel(0, 600); await page.waitForTimeout(50);
    assert.deepEqual(await pageNumber(page), initial); assert.equal(await page.locator('.viewport').evaluate(e => e.scrollTop), 0);
    await page.locator('.viewport').focus(); await page.keyboard.press('PageDown'); assert.deepEqual(await pageNumber(page), initial);
    await page.keyboard.press('ArrowRight'); assert.equal((await pageNumber(page))[0], 2);
    await page.keyboard.press('ArrowLeft'); assert.equal((await pageNumber(page))[0], 1);
    await page.getByRole('button', { name: '下一页', exact: true }).click(); assert.equal((await pageNumber(page))[0], 2);
    const steps = Math.min(initial[1] - 3, Math.floor(initial[1] * .6));
    for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight');
    assert.ok(Number(await page.locator('.page-flow:not(.page-measure)').getAttribute('data-start')) > 0, 'long chapter crosses bounded layout chunks');
    assert.ok((await page.locator('.page-flow:not(.page-measure)').textContent())!.length <= 16384);
    const anchor = current.absolutePosition;
    await page.setViewportSize({ width: 300, height: 500 }); await ready(page);
    const start = Number(await page.locator('.page-counter').getAttribute('data-page-start')), end = Number(await page.locator('.page-counter').getAttribute('data-page-end'));
    assert.ok(start <= anchor && anchor <= end, 'resizing keeps the text anchor on the current page');
    assert.equal(current.absolutePosition, anchor, 'passive layout must not rewrite reading progress');
    const textPoint = await page.evaluate(() => {
      const flow = document.querySelector<HTMLElement>('.page-flow:not(.page-measure)')!, text = flow.textContent!, node = flow.firstChild!;
      const counter = document.querySelector<HTMLElement>('.page-counter')!, bounds = document.querySelector('.viewport')!.getBoundingClientRect();
      const start = Number(counter.dataset.pageStart) - Number(flow.dataset.start), end = Number(counter.dataset.pageEnd) - Number(flow.dataset.start);
      for (let offset = start; offset < end; offset++) {
        if (/\s/.test(text[offset])) continue;
        const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1); const rect = range.getBoundingClientRect();
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        if (x > bounds.left + bounds.width * 2 / 3 && x < bounds.right && y > bounds.top && y < bounds.bottom) return { x, y };
      }
      return null;
    });
    assert.ok(textPoint, 'narrow reader has text inside the right click zone'); const beforeTextClick = (await pageNumber(page))[0];
    await page.mouse.click(textPoint.x, textPoint.y); assert.equal((await pageNumber(page))[0], beforeTextClick + 1, 'clicking text also turns exactly one page');
    await chapterAction(page, '下一章'); await ready(page, '第二章 继续'); assert.equal((await pageNumber(page))[0], 1);
    await tap(.1); await ready(page, '第一章 起点');
    const previousEnd = await pageNumber(page); assert.equal(previousEnd[0], previousEnd[1]);
    await tap(.9); await ready(page, '第二章 继续'); assert.equal((await pageNumber(page))[0], 1);
    await page.getByRole('button', { name: '上一页', exact: true }).click(); await ready(page, '第一章 起点');
    await chapterAction(page, '下一章'); await ready(page, '第二章 继续');
    await chapterAction(page, '上一章'); await ready(page, '第一章 起点'); assert.equal((await pageNumber(page))[0], 1);
    await page.getByRole('button', { name: '目录', exact: true }).click(); await page.getByRole('button', { name: '第二章 继续', exact: true }).click(); await ready(page, '第二章 继续');
    assert.equal(await page.locator('.chapter-title').textContent(), '第二章 继续');
    await page.setViewportSize({ width: 650, height: 320 }); await ready(page);
    await mkdir('.test-data/screenshots', { recursive: true }); await page.screenshot({ path: '.test-data/screenshots/reader-v040.png' });
    await page.getByRole('button', { name: '操作菜单', exact: true }).click(); assert.equal(await page.getByRole('button', { name: '导入书籍', exact: true }).count(), 0); await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Alt+h'); await page.waitForTimeout(30); assert.equal(await page.locator('.page-flow').count(), 0); assert.equal(await page.locator('#app').textContent(), 'Ready');

    const books = [{ id, displayTitle: '<script>alert(1)</script> 示例书', author: '测试作者', format: 'epub', progress: 23.4, lastReadAt: Date.now() }];
    const management = { type: 'library', token: 'test-token', books, statistics: { today: 35, total: 35, perBook: { [id]: 35 }, days: { '2026-10-23': 0, '2026-10-24': 0, '2026-10-25': 0, '2026-10-26': 0, '2026-10-27': 0, '2026-10-28': 0, '2026-10-29': 35 } }, records: [{ id: 'day', bookId: id, date: '2026-10-29', seconds: 35, startProgress: 0, endProgress: 23.4 }] };
    await page.setViewportSize({ width: 300, height: 720 }); await dispatch(page, management);
    assert.equal(await page.getByRole('button', { name: '导入书籍', exact: true }).count(), 1); assert.equal(await page.locator('.book-row').count(), 1); assert.equal(await page.locator('.book-title script').count(), 0);
    await page.getByRole('searchbox').fill('不存在'); assert.equal(await page.locator('.book-row').count(), 0); await page.getByRole('searchbox').fill('示例');
    assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await page.screenshot({ path: '.test-data/screenshots/library-sidebar.png' });
    await dispatch(page, { ...management, type: 'statistics' }); assert.equal(await page.locator('.chart-item').count(), 7); assert.equal(await page.locator('.record').count(), 1); assert.match(await page.locator('.record').textContent() ?? '', /35 秒/);
    assert.equal(await page.getByRole('button', { name: '导入书籍', exact: true }).count(), 0); await page.screenshot({ path: '.test-data/screenshots/statistics-v040.png', fullPage: true });
    const settings = { type: 'settings', token: 'settings-token', values: { fontSize: 0, lineHeight: 1.8, panelReaderSide: 'right' }, effective: { fontSize: 14, lineHeight: 1.8, fontFamily: 'var(--vscode-font-family, sans-serif)' }, hasBook: true };
    await dispatch(page, settings); assert.equal(await page.getByRole('button', { name: '导入书籍', exact: true }).count(), 0);
    assert.equal(await page.locator('#font-size').isHidden(), true); assert.equal(await page.locator('.management-header').count(), 0);
    assert.ok(!(await page.locator('#app').textContent())!.includes('120 秒'));
    await page.getByLabel('字号跟随 VS Code').uncheck(); await page.getByLabel('字号（px）').fill('20');
    await page.evaluate("document.getElementById('line-height').value = '2'; document.getElementById('line-height').dispatchEvent(new Event('input', {bubbles:true}))");
    await page.getByLabel('阅读器位置', { exact: true }).selectOption('left');
    assert.equal(await page.locator('.layout-preview span').first().textContent(), 'Reader');
    assert.equal(await page.locator('.reading-preview').evaluate(e => getComputedStyle(e).fontSize), '20px'); assert.equal(await page.locator('.reading-preview').evaluate(e => getComputedStyle(e).lineHeight), '40px');
    await page.getByRole('button', { name: '保存设置', exact: true }).click(); await page.waitForTimeout(50);
    assert.deepEqual(messages.filter(m => m.type === 'saveSettings').at(-1).values, { fontSize: 20, lineHeight: 2, panelReaderSide: 'left' });
    await dispatch(page, { ...settings, values: { fontSize: 20, lineHeight: 2, panelReaderSide: 'left' } }); await dispatch(page, { type: 'settingsSaved', token: 'settings-token' });
    assert.equal(await page.getByRole('status').textContent(), '已保存。'); assert.ok(await page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'));
    await page.screenshot({ path: '.test-data/screenshots/settings-v040.png', fullPage: true });
    const saves = messages.filter(m => m.type === 'saveSettings').length;
    await page.getByLabel('字号（px）').fill('7'); await page.getByRole('button', { name: '保存设置', exact: true }).click(); assert.equal(messages.filter(m => m.type === 'saveSettings').length, saves);
    await page.getByRole('button', { name: '恢复默认设置', exact: true }).click(); assert.equal(await page.getByLabel('字号跟随 VS Code').isChecked(), true);
    await page.getByRole('button', { name: '保存并继续阅读', exact: true }).click(); await page.waitForTimeout(50);
    assert.equal(messages.filter(m => m.type === 'saveSettings').at(-1).resume, true);
    await page.keyboard.press('Control+Alt+h'); await page.waitForTimeout(30); assert.equal(await page.locator('.settings-form').count(), 0); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('三种模式在 300/360/480/1000px 标题与按钮同排紧凑布局，标题居中且操作可达', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = [], messages: any[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('postToHost', (m: any) => { messages.push(m); });
    await page.setContent('<!DOCTYPE html><html lang="zh-CN"><body><div id="app"></div></body></html>');
    await page.evaluate("window.acquireVsCodeApi = () => ({postMessage: window.postToHost, setState: () => {}})");
    await page.addStyleTag({ path: path.resolve('dist/webview.css') }); await page.addScriptTag({ path: path.resolve('dist/webview.js') });
    await mkdir('.test-data/screenshots', { recursive: true });
    for (const mode of ['sidebar', 'editor', 'panel']) for (const width of [300, 360, 480, 1000]) {
      await page.setViewportSize({ width, height: 640 });
      const payload = reader(positionAt(content, 5000), mode); await dispatch(page, payload); await ready(page);
      const geometry = await page.evaluate(() => {
        const rect = document.querySelector('#app')!.getBoundingClientRect(), center = rect.left + rect.width / 2;
        const titles = Array.from(document.querySelectorAll<HTMLElement>('.chapter-title,.book-name')).map(e => {
          const range = document.createRange(); range.selectNodeContents(e); const bounds = range.getBoundingClientRect();
          return { delta: Math.abs(bounds.left + bounds.width / 2 - center), align: getComputedStyle(e).textAlign };
        });
        const buttons = Array.from(document.querySelectorAll<HTMLElement>('.toolbar button')).filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
        const toolbar = document.querySelector('.toolbar')!.getBoundingClientRect(), heading = document.querySelector('.reader-heading')!.getBoundingClientRect();
        const overlaps = buttons.some((a, i) => buttons.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
        const sameRow = buttons.every(b => Math.abs(b.top + b.height / 2 - heading.top - heading.height / 2) < 1);
        const titleOverlap = buttons.some(b => b.left < heading.right && b.right > heading.left);
        return { titles, overlaps, sameRow, titleOverlap, height: toolbar.height, overflow: document.documentElement.scrollWidth > innerWidth, outside: buttons.some(b => b.left < 0 || b.right > innerWidth) };
      });
      assert.ok(geometry.titles.every(t => t.delta < 1 && t.align === 'center'), `${mode}/${width}: text centered on reading area`);
      assert.equal(geometry.overlaps || geometry.titleOverlap || geometry.overflow || geometry.outside, false);
      assert.equal(geometry.sameRow, true, `${mode}/${width}: titles and buttons share one row`); assert.equal(geometry.height, 42);
      for (const name of ['上一页', '下一页', '目录', '操作菜单', '隐藏全部内容 (Ctrl+Alt+H)']) assert.ok(await page.getByRole('button', { name, exact: true }).isVisible());
      assert.equal(await page.locator('.toolbar .expanded-action').first().isVisible(), width >= 480);
      await page.getByRole('button', { name: '操作菜单', exact: true }).click();
      if (width < 480) {
        for (const name of ['上一章', '下一章', '快速排版设置']) assert.ok(await page.locator('#menu').getByRole('button', { name, exact: true }).isVisible());
        await page.locator('#menu').getByRole('button', { name: '下一章', exact: true }).click();
        assert.equal(messages.at(-1).action, 'nextChapter');
      } else await page.keyboard.press('Escape');
      await page.locator('.viewport').focus(); await page.keyboard.press('Alt+ArrowRight'); assert.equal(messages.at(-1).action, 'nextChapter');
      const long = { ...payload, title: '非常长的书名与完整悬浮提示'.repeat(20), chapter: { ...payload.chapter, title: '非常长的章节名'.repeat(20) } };
      await dispatch(page, long); await ready(page);
      for (const selector of ['.chapter-title', '.book-name']) {
        const title = page.locator(selector); assert.equal(await title.getAttribute('title'), await title.textContent());
        assert.ok(await title.evaluate(e => e.scrollWidth > e.clientWidth && getComputedStyle(e).textOverflow === 'ellipsis'));
      }
      if (mode === 'editor') await page.screenshot({ path: `.test-data/screenshots/reader-v050-${width}.png` });
    }
    await page.setViewportSize({ width: 300, height: 120 }); await dispatch(page, reader()); await ready(page);
    assert.match(await page.locator('.page-counter').textContent() ?? '', /^\d+ \/ \d+$/, 'compact toolbar leaves a readable line in a short pane');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('实际正文排版预览、应用与失败重试、取消及隐藏切书恢复稳定位置', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 720 } }); const errors: string[] = [], messages: any[] = [];
    page.on('pageerror', e => errors.push(e.message));
    let current = reader(positionAt(content, 17567)); let failSave = false;
    await page.exposeFunction('postToHost', async (m: any) => {
      messages.push(m);
      if (m.type === 'pagePosition') { current.position = positionAt(content, m.absolute, m.atEnd); current.absolutePosition = m.absolute; }
      if (m.type === 'saveReaderSettings') {
        if (failSave) { failSave = false; await dispatch(page, { type: 'readerSettingsError', token: current.token, requestId: m.requestId, message: '测试保存失败' }); }
        else {
          current = { ...current, settings: { ...current.settings, fontSize: m.values.fontSize || 15, lineHeight: m.values.lineHeight }, preferences: { ...current.preferences, ...m.values } };
          await dispatch(page, current);
        }
      }
    });
    await page.setContent('<!DOCTYPE html><html lang="zh-CN"><body><div id="app"></div></body></html>');
    await page.evaluate("window.acquireVsCodeApi = () => ({postMessage: window.postToHost, setState: () => {}})");
    await page.addStyleTag({ path: path.resolve('dist/webview.css') }); await page.addScriptTag({ path: path.resolve('dist/webview.js') });
    async function openQuick() {
      if (!(await page.locator('.toolbar').getByRole('button', { name: '快速排版设置', exact: true }).isVisible())) await page.getByRole('button', { name: '操作菜单', exact: true }).click();
      await page.getByRole('button', { name: '快速排版设置', exact: true }).click();
    }
    async function preview(size = 32, height = '2.4') {
      await page.getByLabel('字号跟随 VS Code').uncheck(); await page.getByLabel('字号（px）', { exact: true }).fill(String(size));
      await page.locator('#quick-line-height').evaluate((e, value) => { (e as HTMLInputElement).value = value; e.dispatchEvent(new Event('input', { bubbles: true })); }, height); await ready(page);
      assert.equal(await page.locator('.viewport').evaluate(e => getComputedStyle(e).fontSize), `${size}px`);
      const range = await page.locator('.page-counter').evaluate(e => ({ start: Number((e as HTMLElement).dataset.pageStart), end: Number((e as HTMLElement).dataset.pageEnd) }));
      assert.ok(range.start <= current.absolutePosition && (range.end > current.absolutePosition || current.position.atEnd && range.end === current.absolutePosition), 'same text anchor remains on the visible page');
    }
    for (const mode of ['sidebar', 'editor', 'panel']) {
      current = reader(positionAt(content, 17567), mode); await dispatch(page, current); await ready(page);
      const before = await pageNumber(page), start = await page.locator('.page-counter').getAttribute('data-page-start');
      await openQuick(); await preview();
      if (mode === 'editor') await page.screenshot({ path: '.test-data/screenshots/quick-settings-v050.png' });
      assert.equal(messages.filter(m => m.type === 'saveReaderSettings').length, 0, 'preview never persists settings');
      const afterPreview = await pageNumber(page), viewport = (await page.locator('.viewport').boundingBox())!;
      await page.mouse.click(viewport.x + viewport.width * .9, viewport.y + viewport.height - 10);
      assert.deepEqual(await pageNumber(page), afterPreview, 'overlay background click cannot turn a page');
      await page.getByRole('button', { name: '取消', exact: true }).click(); await ready(page);
      assert.equal(await page.locator('.viewport').evaluate(e => getComputedStyle(e).fontSize), '15px');
      assert.deepEqual(await pageNumber(page), before); assert.equal(await page.locator('.page-counter').getAttribute('data-page-start'), start);
      await openQuick(); await preview(40, '3'); await page.keyboard.press('Escape'); await ready(page);
      assert.deepEqual(await pageNumber(page), before); assert.ok(await page.locator('.viewport').evaluate(e => e === document.activeElement));
      await openQuick(); await preview(8, '1.2'); await page.getByRole('button', { name: '完整设置', exact: true }).click(); await ready(page);
      assert.equal(messages.filter(m => m.type === 'action').at(-1).action, 'settings'); assert.deepEqual(await pageNumber(page), before);
    }
    await openQuick(); await preview(21, '2');
    await page.getByLabel('字号（px）', { exact: true }).fill('7'); await page.getByRole('button', { name: '应用排版设置' }).click();
    assert.equal(messages.filter(m => m.type === 'saveReaderSettings').length, 0);
    await page.getByLabel('字号（px）', { exact: true }).fill('21'); failSave = true;
    await page.getByRole('button', { name: '应用排版设置' }).click(); await page.getByText('测试保存失败').waitFor();
    assert.ok(await page.getByRole('button', { name: '应用排版设置' }).isEnabled());
    await page.getByRole('button', { name: '应用排版设置' }).click(); await page.locator('#quick-settings').waitFor({ state: 'detached' }); await ready(page);
    assert.deepEqual(current.preferences, { fontSize: 21, lineHeight: 2, panelReaderSide: 'right' }); assert.equal(current.absolutePosition, 17567);
    await openQuick(); await page.getByLabel('字号跟随 VS Code').check(); await ready(page);
    assert.equal(await page.locator('.viewport').evaluate(e => getComputedStyle(e).fontSize), '15px');
    await page.getByRole('button', { name: '应用排版设置' }).click(); await page.locator('#quick-settings').waitFor({ state: 'detached' }); await ready(page);
    assert.equal(current.preferences.fontSize, 0);
    await openQuick(); await preview(); await dispatch(page, { ...reader(positionAt(content, 3000)), bookId: 'c'.repeat(64), token: 'new-book' }); await ready(page);
    assert.equal(await page.locator('#quick-settings').count(), 0); assert.equal(await page.locator('.viewport').evaluate(e => getComputedStyle(e).fontSize), '15px');
    current = reader(positionAt(content, 17567)); await dispatch(page, current); await ready(page);
    await openQuick(); await preview(); await page.keyboard.press('Control+Alt+h');
    assert.equal(await page.locator('#app').textContent(), 'Ready'); assert.equal(current.absolutePosition, 17567);
    await dispatch(page, current); await ready(page); assert.equal(await page.locator('.viewport').evaluate(e => getComputedStyle(e).fontSize), '15px');
    await page.getByRole('button', { name: '目录', exact: true }).click(); await page.getByRole('searchbox').fill('secret search');
    await page.keyboard.press('Control+Alt+h'); await dispatch(page, current); await ready(page);
    await page.getByRole('button', { name: '目录', exact: true }).click(); assert.equal(await page.getByRole('searchbox').inputValue(), '');
    await page.keyboard.press('Escape'); await openQuick(); await preview(); await dispatch(page, { type: 'hidden' });
    assert.equal(await page.locator('#app').textContent(), 'Ready');
    current = reader(positionAt(content, content.totalLength, true)); await dispatch(page, current); await ready(page);
    const last = await pageNumber(page); await openQuick(); await preview(20, '2'); await page.keyboard.press('Escape'); await ready(page);
    assert.deepEqual(await pageNumber(page), last);
    await page.keyboard.press('Control+Alt+h'); assert.equal(current.position.atEnd, true, 'cancel preserves the completed-book position');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
