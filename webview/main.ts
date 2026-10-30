import type { ReaderPreferences, TocItem } from '../src/model';
import { ReaderView } from './reader';
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(state: unknown): void };
const api = acquireVsCodeApi();
const app = document.getElementById('app')!;
let data: any; let readerView: ReaderView | undefined;
let activityAt = 0; let search = ''; let filter = ''; let recordLimit = 50;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.className = className; if (text !== undefined) e.textContent = text; return e;
}
function send(type: string, extra: Record<string, unknown> = {}) { api.postMessage({ type, token: data?.token, bookId: data?.bookId, ...extra }); }
function action(name: string) { if (data?.type === 'reader') reportPosition(); send('action', { action: name }); }
function button(text: string, title: string, click: () => void, className = '') {
  const b = el('button', className, text); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', click); return b;
}
function conceal() { readerView?.dispose(); readerView = undefined; data = undefined; api.setState(undefined); app.replaceChildren(el('div', 'placeholder', 'Ready')); }
function hide() { if (data?.type === 'reader') reportPosition(); send('hide'); conceal(); }
function time(seconds: number) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = Math.floor(seconds % 60);
  if (h) return `${h} 小时${m ? ` ${m} 分` : ''}`;
  if (m) return `${m} 分${s ? ` ${s} 秒` : ''}`;
  return seconds > 0 ? s ? `${s} 秒` : '不足 1 秒' : '0 分钟';
}
function date(n: number) { return n ? new Date(n).toLocaleString() : '尚未阅读'; }
function activity() { const now = Date.now(); if (now - activityAt > 500) { send('activity'); activityAt = now; } }

function header() {
  const h = el('header', 'toolbar');
  const previous = button('‹', '上一页', () => page(-1)), next = button('›', '下一页', () => page(1)); previous.dataset.page = 'previous'; next.dataset.page = 'next';
  const previousChapter = button('«', '上一章', () => action('previousChapter')), nextChapter = button('»', '下一章', () => action('nextChapter'));
  previousChapter.disabled = data.chapter.index === 0; nextChapter.disabled = data.chapter.index === data.chapter.count - 1;
  const heading = el('div', 'reader-heading'); const chapter = el('div', 'chapter-title', data.chapter.title), book = el('div', 'book-name', data.title);
  chapter.title = data.chapter.title; book.title = data.title; heading.append(chapter, book);
  h.append(previousChapter, previous, heading, next, nextChapter, button('≡', '目录', toggleToc), button('⚙', '阅读设置', () => action('settings')), button('⋯', '操作菜单', toggleMenu), button('—', '隐藏全部内容 (Ctrl+Alt+H)', hide, 'hide'));
  return h;
}
function toggleMenu() {
  const existing = document.getElementById('menu'); if (existing) { existing.remove(); return; }
  document.getElementById('toc')?.remove();
  const menu = el('div', 'menu'); menu.id = 'menu'; menu.setAttribute('role', 'menu');
  const items = [['书架', 'library'], ['记录与统计', 'statistics'], ['切换阅读模式', 'mode'], ['阅读设置', 'settings']];
  for (const [label, name] of items) menu.append(button(label, label, () => { menu.remove(); action(name); }));
  app.append(menu); menu.querySelector('button')?.focus();
}
function toggleToc() {
  if (data?.type !== 'reader') return;
  const existing = document.getElementById('toc'); if (existing) { existing.remove(); readerView?.focus(); return; }
  document.getElementById('menu')?.remove();
  const toc = el('aside', 'toc'); toc.id = 'toc'; toc.setAttribute('aria-label', '章节目录');
  toc.append(el('div', 'section-label', '章节目录'), button('关闭', '关闭目录', () => { toc.remove(); readerView?.focus(); }));
  let current: HTMLButtonElement | undefined;
  for (const [index, t] of (data.toc as TocItem[]).entries()) {
    const entry = button(t.title, t.title, () => {
      reportPosition(); send('jump', { position: { sectionId: t.sectionId, offset: t.offset, atEnd: false } }); toc.remove();
    });
    if (index === data.chapter.tocIndex) { entry.setAttribute('aria-current', 'location'); current = entry; }
    toc.append(entry);
  }
  app.append(toc);
  if (current) {
    current.focus({ preventScroll: true });
    toc.scrollTop = Math.max(0, current.offsetTop - (toc.clientHeight - current.offsetHeight) / 2);
  } else toc.querySelector('button')?.focus();
}

function renderReader() {
  readerView?.dispose(); app.replaceChildren(header()); app.className = `reader ${data.mode}`;
  readerView = new ReaderView(app, data, { send, activity, ready: () => send('rendered') });
}
function reportPosition() { readerView?.reportPosition(); }
function page(direction: number) { readerView?.page(direction); }

function managementHeader() {
  const nav = el('nav', 'tabs');
  nav.append(button('书架', '书架', () => action('library'), data.type === 'library' ? 'selected' : ''), button('记录', '记录与统计', () => action('statistics'), data.type === 'statistics' ? 'selected' : ''), button('设置', '阅读设置', () => action('settings'), data.type === 'settings' ? 'selected' : ''), button('继续', '继续阅读', () => action('resume')), button('—', '隐藏全部内容', hide, 'hide'));
  return [nav];
}
function renderManagement() {
  readerView?.dispose(); readerView = undefined; app.className = 'management'; app.replaceChildren(...managementHeader());
  if (data.type === 'library') renderLibrary(); else if (data.type === 'settings') renderSettings(); else renderStatistics();
}
function renderSettings() {
  const body = el('main', 'management-body settings-body');
  body.append(el('h1', '', '阅读设置'));
  const form = el('form', 'settings-form');
  const appearance = el('fieldset', 'settings-group'); appearance.append(el('legend', '', '正文排版'));
  const followLabel = el('label', 'checkbox-row'); const follow = el('input'); follow.type = 'checkbox'; follow.checked = data.values.fontSize === 0;
  followLabel.append(follow, document.createTextNode('字号跟随 VS Code'));
  const size = el('input'); size.type = 'number'; size.min = '8'; size.max = '40'; size.step = '1'; size.required = true; size.value = String(data.values.fontSize || data.effective.fontSize); size.id = 'font-size';
  const sizeLabel = el('label', 'field-label', '字号（px）'); sizeLabel.htmlFor = size.id;
  const height = el('input'); height.type = 'range'; height.min = '1.2'; height.max = '3'; height.step = '0.1'; height.value = String(data.values.lineHeight); height.id = 'line-height';
  const heightLabel = el('label', 'field-label'); heightLabel.htmlFor = height.id;
  appearance.append(followLabel, sizeLabel, size, heightLabel, height);
  const preview = el('div', 'reading-preview', '山间的风掠过树梢，书页轻轻翻动。\n读过的文字，会留在心里。'); preview.setAttribute('aria-label', '正文排版预览'); preview.style.fontFamily = data.effective.fontFamily;
  appearance.append(preview);
  const layout = el('fieldset', 'settings-group'); layout.append(el('legend', '', '底部分栏'));
  const side = el('select'); side.id = 'reader-side';
  for (const [value, label] of [['right', '左侧 Terminal · 右侧 Reader'], ['left', '左侧 Reader · 右侧 Terminal']]) { const option = el('option', '', label); option.value = value; side.append(option); }
  side.value = data.values.panelReaderSide;
  const sideLabel = el('label', 'field-label', '阅读器位置'); sideLabel.htmlFor = side.id;
  const layoutPreview = el('div', 'layout-preview'); layoutPreview.setAttribute('aria-label', '底部分栏预览');
  layout.append(sideLabel, side, layoutPreview);
  const status = el('p', 'settings-status'); status.id = 'settings-status'; status.setAttribute('role', 'status');
  const controls = el('div', 'settings-actions');
  const save = button('保存设置', '保存设置', () => {} , 'primary'); save.type = 'submit';
  const resume = button('保存并继续阅读', '保存并继续阅读', () => submit(true)); resume.disabled = !data.hasBook;
  const reset = button('恢复默认', '恢复默认设置', () => { follow.checked = true; size.value = String(data.effective.fontSize); height.value = '1.8'; side.value = 'right'; updatePreview(); status.textContent = '已恢复默认，待保存'; });
  controls.append(save, resume, reset);
  const values = (): ReaderPreferences => ({ fontSize: follow.checked ? 0 : Number(size.value), lineHeight: Number(height.value), panelReaderSide: side.value as 'left' | 'right' });
  function updatePreview() {
    size.disabled = follow.checked; size.hidden = follow.checked; sizeLabel.hidden = follow.checked; heightLabel.textContent = `行高 · ${Number(height.value).toFixed(1)} 倍`;
    preview.style.fontSize = `${follow.checked ? data.effective.fontSize : Math.min(40, Math.max(8, Number(size.value) || 14))}px`;
    preview.style.lineHeight = height.value;
    const terminal = el('span', 'layout-terminal', 'Terminal'); const reader = el('span', 'layout-reader', 'Reader');
    layoutPreview.replaceChildren(...(side.value === 'right' ? [terminal, reader] : [reader, terminal]));
    status.textContent = ''; status.classList.remove('error');
  }
  function submit(continueReading: boolean) {
    if (!form.reportValidity()) return;
    save.disabled = true; resume.disabled = true; status.textContent = '正在保存…';
    send('saveSettings', { values: values(), resume: continueReading });
  }
  form.addEventListener('submit', e => { e.preventDefault(); submit(false); });
  for (const input of [follow, size, height, side]) input.addEventListener('input', updatePreview);
  form.append(appearance, layout, controls, status); body.append(form); app.append(body); updatePreview();
}
function renderLibrary() {
  const body = el('main', 'management-body'), heading = el('div', 'library-heading');
  heading.append(el('h1', '', '本地书架'), button('导入书籍', '导入书籍', () => action('import'), 'primary'));
  body.append(heading, el('p', 'muted', `${data.books.length} 本书`));
  const input = el('input', 'search'); input.type = 'search'; input.placeholder = '按书名筛选'; input.setAttribute('aria-label', '按书名筛选'); input.value = search;
  const list = el('div', 'book-list');
  const fill = () => {
    list.replaceChildren(); const books = data.books.filter((b: any) => b.displayTitle.toLowerCase().includes(search.toLowerCase()));
    if (!data.books.length) { const empty = el('div', 'empty'); empty.append(el('p', 'muted', '暂无书籍')); list.append(empty); }
    else if (!books.length) list.append(el('p', 'empty muted', '没有匹配的书籍'));
    for (const book of books) {
      const row = el('article', 'book-row'); const info = el('div', 'book-info');
      info.append(button(book.displayTitle, `继续阅读 ${book.displayTitle}`, () => send('open', { id: book.id }), 'book-title'), el('div', 'muted', [book.author, book.format.toUpperCase(), book.progress === 100 ? '已读完' : book.lastReadAt ? '阅读中' : '未读'].filter(Boolean).join(' · ')), el('div', 'muted small', `最近：${date(book.lastReadAt)} · 累计 ${time(data.statistics.perBook[book.id] ?? 0)}`));
      const meter = el('progress'); meter.max = 100; meter.value = book.progress; meter.setAttribute('aria-label', `当前进度 ${book.progress.toFixed(1)}%`);
      info.append(meter, el('span', 'progress-text', `${book.progress.toFixed(1)}%`));
      const controls = el('div', 'row-actions'); controls.append(button('继续', '继续阅读', () => send('open', { id: book.id })), button('改名', '修改显示书名', () => send('rename', { id: book.id })), button('移除', '移除书籍及记录', () => send('remove', { id: book.id }), 'quiet'));
      row.append(info, controls); list.append(row);
    }
  };
  input.addEventListener('input', () => { search = input.value; fill(); }); fill(); body.append(input, list); app.append(body);
}
function renderStatistics() {
  const body = el('main', 'management-body'); body.append(el('h1', '', '阅读记录与时长'));
  const metrics = el('div', 'metrics');
  for (const [label, seconds] of [['今日', data.statistics.today], ['最近 7 天', Object.values<number>(data.statistics.days).reduce((a, b) => a + b, 0)], ['累计', data.statistics.total]] as [string, number][]) {
    const card = el('div', 'metric'); card.append(el('div', 'muted', label), el('strong', '', time(seconds))); metrics.append(card);
  }
  body.append(metrics, el('h2', '', '最近 7 天'));
  const chart = el('div', 'chart'); const max = Math.max(60, ...Object.values<number>(data.statistics.days));
  for (const [date, seconds] of Object.entries<number>(data.statistics.days)) {
    const item = el('div', 'chart-item'); const track = el('div', 'chart-track'); const bar = el('div', 'chart-bar'); bar.style.height = `${Math.max(1, seconds / max * 100)}%`; track.append(bar);
    const label = seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} 时` : seconds >= 60 ? `${Math.floor(seconds / 60)} 分` : `${Math.floor(seconds)} 秒`;
    item.title = `${date}：${time(seconds)}`; item.append(el('span', 'small', label), track, el('span', 'small muted', date.slice(5))); chart.append(item);
  }
  body.append(chart);
  body.append(el('h2', '', '单书时长'));
  const summary = el('div', 'book-summary');
  for (const book of data.books) { const row = el('div', 'summary-row'); row.append(el('span', '', book.displayTitle), el('span', 'muted', time(data.statistics.perBook[book.id] ?? 0))); summary.append(row); }
  if (!data.books.length) summary.append(el('p', 'muted', '暂无书籍')); body.append(summary, el('h2', '', '阅读记录'));
  const select = el('select'); select.setAttribute('aria-label', '按书籍筛选阅读记录'); const all = el('option', '', '全部书籍'); all.value = ''; select.append(all);
  for (const book of data.books) { const option = el('option', '', book.displayTitle); option.value = book.id; select.append(option); }
  select.value = filter; const records = el('div', 'records');
  const fill = () => {
    records.replaceChildren(); const sessions = data.records.filter((s: any) => !filter || s.bookId === filter);
    for (const session of sessions.slice(0, recordLimit)) {
      const book = data.books.find((b: any) => b.id === session.bookId); if (!book) continue;
      const details = session.progressExact === false ? session.date : `${session.date} · ${session.startProgress.toFixed(1)}% → ${session.endProgress.toFixed(1)}%`;
      const row = el('article', 'record'); row.append(el('strong', '', book.displayTitle), el('span', '', time(session.seconds)), el('div', 'muted small record-meta', details)); records.append(row);
    }
    if (!sessions.length) records.append(el('p', 'empty muted', '暂无有效阅读记录'));
    if (sessions.length > recordLimit) records.append(button('加载更多', '加载更多记录', () => { recordLimit += 50; fill(); }));
  };
  select.addEventListener('change', () => { filter = select.value; recordLimit = 50; fill(); }); fill(); body.append(select, records); app.append(body);
}

window.addEventListener('message', event => {
  const m = event.data; if (!m || typeof m.type !== 'string') return;
  if (m.type === 'hidden') { conceal(); return; }
  if (m.type === 'navigate') { page(m.action === 'nextPage' ? 1 : -1); return; }
  if (m.type === 'toc') { toggleToc(); return; }
  if ((m.type === 'settingsSaved' || m.type === 'settingsError') && data?.type === 'settings' && m.token === data.token) {
    const status = document.getElementById('settings-status'); if (status) { status.textContent = m.type === 'settingsSaved' ? '已保存。' : m.message; status.classList.toggle('error', m.type === 'settingsError'); }
    for (const b of app.querySelectorAll<HTMLButtonElement>('.settings-actions button')) b.disabled = b.textContent === '保存并继续阅读' && !data.hasBook;
    return;
  }
  if (['reader', 'library', 'statistics', 'settings'].includes(m.type)) {
    data = m; if (m.type === 'reader') renderReader(); else { renderManagement(); send('rendered'); }
  }
});
document.addEventListener('keydown', e => {
  if (e.isComposing || e.key === 'Process' || !data) return;
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); hide(); return; }
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); action('resume'); return; }
  const overlay = document.getElementById('menu') ?? document.getElementById('toc');
  if (e.key === 'Escape' && overlay) { overlay.remove(); readerView?.focus(); e.preventDefault(); return; }
  if (data.type !== 'reader' || !(e.target instanceof Element) || e.target.closest('input,select,textarea,button') || overlay) return;
  if (e.key === 'Escape') { e.preventDefault(); hide(); }
  if (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === ' ') e.preventDefault();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); if (e.altKey) action(e.key === 'ArrowRight' ? 'nextChapter' : 'previousChapter'); else if (!e.ctrlKey && !e.metaKey) page(e.key === 'ArrowRight' ? 1 : -1); }
});
window.addEventListener('blur', () => { if (data?.type === 'reader') reportPosition(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && data?.type === 'reader') reportPosition(); });
api.setState(undefined); send('ready');
