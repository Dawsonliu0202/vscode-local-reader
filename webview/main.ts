import type { ReaderPreferences, TocItem } from '../src/model';
import { filterToc } from '../src/model';
import { ReaderView } from './reader';
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(state: unknown): void };
const api = acquireVsCodeApi();
const app = document.getElementById('app')!;
let data: any; let readerView: ReaderView | undefined;
let activityAt = 0; let search = ''; let filter = ''; let recordLimit = 50;
let cancelQuickSettings: (() => void) | undefined;
let settingsRequest = 0;
function closeOverlays(focus = false) {
  cancelQuickSettings?.(); document.getElementById('menu')?.remove(); document.getElementById('toc')?.remove();
  if (focus) readerView?.focus();
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); e.className = className; if (text !== undefined) e.textContent = text; return e;
}
function send(type: string, extra: Record<string, unknown> = {}) { api.postMessage({ type, token: data?.token, bookId: data?.bookId, ...extra }); }
function action(name: string) { closeOverlays(); if (data?.type === 'reader') reportPosition(); send('action', { action: name }); }
function button(text: string, title: string, click: () => void, className = '') {
  const b = el('button', className, text); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title); b.addEventListener('click', click); return b;
}
function conceal() { closeOverlays(); readerView?.dispose(); readerView = undefined; data = undefined; search = ''; filter = ''; api.setState(undefined); app.replaceChildren(el('div', 'placeholder', 'Ready')); }
function hide() { closeOverlays(); if (data?.type === 'reader') reportPosition(); send('hide'); conceal(); }
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
  const navigation = el('div', 'toolbar-group'), operations = el('div', 'toolbar-group');
  const previous = button('‹', '上一页', () => page(-1)), next = button('›', '下一页', () => page(1)); previous.dataset.page = 'previous'; next.dataset.page = 'next';
  const previousChapter = button('«', '上一章', () => action('previousChapter'), 'expanded-action'), nextChapter = button('»', '下一章', () => action('nextChapter'), 'expanded-action');
  previousChapter.disabled = data.chapter.index === 0; nextChapter.disabled = data.chapter.index === data.chapter.count - 1;
  const heading = el('div', 'reader-heading'); const chapter = el('div', 'chapter-title', data.chapter.title), book = el('div', 'book-name', data.title);
  chapter.title = data.chapter.title; book.title = data.title; heading.append(chapter, book);
  navigation.append(previousChapter, previous, next, nextChapter);
  operations.append(button('≡', '目录', toggleToc), button('⚙', '快速排版设置', toggleQuickSettings, 'expanded-action'), button('⋯', '操作菜单', toggleMenu), button('—', '隐藏全部内容 (Ctrl+Alt+H)', hide, 'hide'));
  h.append(navigation, heading, operations);
  return h;
}
function toggleMenu() {
  const existing = document.getElementById('menu'); if (existing) { closeOverlays(true); return; }
  closeOverlays();
  const menu = el('div', 'menu'); menu.id = 'menu'; menu.setAttribute('role', 'menu');
  for (const [label, name, disabled] of [['上一章', 'previousChapter', data.chapter.index === 0], ['下一章', 'nextChapter', data.chapter.index === data.chapter.count - 1]] as const) {
    const entry = button(label, label, () => action(name), 'compact-action'); entry.disabled = disabled; menu.append(entry);
  }
  menu.append(button('快速排版设置', '快速排版设置', toggleQuickSettings, 'compact-action'));
  const items = [['书架', 'library'], ['记录与统计', 'statistics'], ['切换阅读模式', 'mode'], ['完整设置', 'settings']];
  for (const [label, name] of items) menu.append(button(label, label, () => { menu.remove(); action(name); }));
  app.append(menu); Array.from(menu.querySelectorAll('button')).find(b => !b.disabled && b.getClientRects().length)?.focus();
}
function toggleToc() {
  if (data?.type !== 'reader') return;
  const existing = document.getElementById('toc'); if (existing) { closeOverlays(true); return; }
  closeOverlays();
  const toc = el('aside', 'toc'); toc.id = 'toc'; toc.setAttribute('aria-label', '章节目录');
  const top = el('div', 'toc-header'), title = el('div', 'toc-title');
  title.append(el('div', 'section-label', '章节目录'), button('关闭', '关闭目录', () => closeOverlays(true)));
  const input = el('input', 'toc-search'); input.type = 'search'; input.placeholder = '搜索章节名或章号'; input.setAttribute('aria-label', input.placeholder); input.setAttribute('aria-controls', 'toc-list');
  const controls = el('div', 'toc-actions');
  const clear = button('清空筛选', '清空筛选', reset);
  controls.append(button('回到当前章', '回到当前章', reset), clear);
  const list = el('div', 'toc-list'); list.id = 'toc-list';
  const count = el('div', 'toc-count muted small'); count.setAttribute('role', 'status');
  top.append(title, input, controls, count); toc.append(top, list);
  let selectedIndex = data.chapter.tocIndex; let entries: HTMLButtonElement[] = []; let composing = false;
  function select(index: number, focus = false) {
    selectedIndex = index;
    for (const entry of entries) { const selected = Number(entry.dataset.tocIndex) === index; entry.classList.toggle('toc-selected', selected); entry.tabIndex = selected ? 0 : -1; }
    const selected = entries.find(entry => Number(entry.dataset.tocIndex) === index);
    if (selected) {
      if (focus) selected.focus({ preventScroll: true });
      const bounds = list.getBoundingClientRect(), item = selected.getBoundingClientRect();
      list.scrollTop += item.top - bounds.top - (list.clientHeight - item.height) / 2;
    }
  }
  function fill() {
    const results = filterToc(data.toc as TocItem[], input.value); list.replaceChildren(); entries = [];
    clear.hidden = !input.value; count.textContent = `${results.length} / ${data.toc.length} 章`;
    for (const { item: t, tocIndex } of results) {
      const entry = button(t.title, t.title, () => {
        reportPosition(); send('jump', { position: { sectionId: t.sectionId, offset: t.offset, atEnd: false } }); closeOverlays(true);
      });
      entry.dataset.tocIndex = String(tocIndex);
      if (tocIndex === data.chapter.tocIndex) entry.setAttribute('aria-current', 'location');
      entry.addEventListener('focus', () => select(tocIndex));
      entries.push(entry); list.append(entry);
    }
    if (!entries.length) {
      const empty = el('div', 'toc-empty'); empty.append(el('p', 'muted', '没有匹配的章节'), button('清空搜索', '清空搜索', reset)); list.append(empty);
    }
    select(results.some(r => r.tocIndex === selectedIndex) ? selectedIndex : results[0]?.tocIndex ?? -1);
  }
  function reset() { input.value = ''; selectedIndex = data.chapter.tocIndex; fill(); input.focus({ preventScroll: true }); }
  input.addEventListener('input', fill);
  toc.addEventListener('compositionstart', () => { composing = true; }); toc.addEventListener('compositionend', () => { composing = false; });
  toc.addEventListener('keydown', e => {
    if (composing || e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target !== input && !(e.target instanceof Element && e.target.closest('.toc-list button[data-toc-index]'))) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); const index = entries.findIndex(entry => Number(entry.dataset.tocIndex) === selectedIndex);
      const next = entries[Math.max(0, Math.min(entries.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) select(Number(next.dataset.tocIndex), true);
    } else if (e.key === 'Enter') { e.preventDefault(); entries.find(entry => Number(entry.dataset.tocIndex) === selectedIndex)?.click(); }
  });
  app.append(toc); fill(); input.focus({ preventScroll: true });
}

function toggleQuickSettings() {
  if (data?.type !== 'reader' || !readerView) return;
  if (cancelQuickSettings) { closeOverlays(true); return; }
  closeOverlays();
  const view = readerView, original = { ...data.settings }, position = view.capturePosition();
  const dialog = el('form', 'quick-settings'); dialog.id = 'quick-settings'; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-label', '快速排版设置');
  const heading = el('div', 'toc-title'); heading.append(el('div', 'section-label', '快速排版'), button('关闭', '取消排版设置', () => closeOverlays(true)));
  const followLabel = el('label', 'checkbox-row'), follow = el('input'); follow.type = 'checkbox'; follow.checked = data.preferences.fontSize === 0;
  followLabel.append(follow, document.createTextNode('字号跟随 VS Code'));
  const editorSize = original.editorFontSize ?? original.fontSize;
  const size = el('input'); size.type = 'number'; size.min = '8'; size.max = '40'; size.step = '1'; size.required = true; size.value = String(data.preferences.fontSize || editorSize); size.id = 'quick-font-size';
  const sizeLabel = el('label', 'field-label', '字号（px）'); sizeLabel.htmlFor = size.id;
  const height = el('input'); height.type = 'range'; height.min = '1.2'; height.max = '3'; height.step = '0.1'; height.value = String(data.preferences.lineHeight); height.id = 'quick-line-height';
  const heightLabel = el('label', 'field-label'); heightLabel.htmlFor = height.id;
  const status = el('p', 'settings-status'); status.id = 'quick-settings-status'; status.setAttribute('role', 'status');
  const controls = el('div', 'settings-actions');
  const apply = button('应用', '应用排版设置', () => {}, 'primary'); apply.type = 'submit';
  controls.append(apply, button('取消', '取消', () => closeOverlays(true)), button('完整设置', '完整设置', () => action('settings')));
  function preview() {
    size.disabled = follow.checked; size.hidden = follow.checked; sizeLabel.hidden = follow.checked;
    heightLabel.textContent = `行高 · ${Number(height.value).toFixed(1)} 倍`;
    if (size.checkValidity()) view.setTypography({ fontSize: follow.checked ? editorSize : Number(size.value), lineHeight: Number(height.value) }, position);
  }
  cancelQuickSettings = () => { cancelQuickSettings = undefined; view.setTypography(original, position); dialog.remove(); };
  for (const input of [follow, size, height]) input.addEventListener('input', preview);
  dialog.addEventListener('submit', e => {
    e.preventDefault(); if (!dialog.reportValidity() || dialog.dataset.saving) return;
    const requestId = String(++settingsRequest); dialog.dataset.requestId = requestId; dialog.dataset.saving = 'true';
    reportPosition(); send('saveReaderSettings', { requestId, values: { fontSize: follow.checked ? 0 : Number(size.value), lineHeight: Number(height.value) } });
    for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = true;
    status.textContent = '正在应用…';
  });
  dialog.append(heading, followLabel, sizeLabel, size, heightLabel, height, controls, status); app.append(dialog); preview(); follow.focus();
}

function renderReader() {
  readerView?.dispose(); app.replaceChildren(header()); app.className = `reader ${data.mode}`;
  readerView = new ReaderView(app, data, { send, activity, ready: () => send('rendered') });
}
function reportPosition() { readerView?.reportPosition(); }
function page(direction: number) { if (!app.querySelector('.toc, .menu, .quick-settings')) readerView?.page(direction); }

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
    preview.style.fontSize = `${follow.checked ? data.effective.editorFontSize ?? data.effective.fontSize : Math.min(40, Math.max(8, Number(size.value) || 14))}px`;
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
  if (m.type === 'readerSettingsError' && m.token === data?.token && data?.type === 'reader') {
    const dialog = document.getElementById('quick-settings');
    if (!dialog || dialog.dataset.requestId !== m.requestId) return;
    delete dialog.dataset.saving;
    const status = document.getElementById('quick-settings-status'); if (status) { status.textContent = m.message; status.classList.add('error'); }
    for (const control of dialog.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = false;
    const follow = dialog.querySelector<HTMLInputElement>('input[type=checkbox]')!, size = dialog.querySelector<HTMLInputElement>('input[type=number]')!; size.disabled = follow.checked;
    return;
  }
  if ((m.type === 'settingsSaved' || m.type === 'settingsError') && data?.type === 'settings' && m.token === data.token) {
    const status = document.getElementById('settings-status'); if (status) { status.textContent = m.type === 'settingsSaved' ? '已保存。' : m.message; status.classList.toggle('error', m.type === 'settingsError'); }
    for (const b of app.querySelectorAll<HTMLButtonElement>('.settings-actions button')) b.disabled = b.textContent === '保存并继续阅读' && !data.hasBook;
    return;
  }
  if (['reader', 'library', 'statistics', 'settings'].includes(m.type)) {
    closeOverlays();
    data = m; if (m.type === 'reader') renderReader(); else { renderManagement(); send('rendered'); }
  }
});
document.addEventListener('keydown', e => {
  if (!data) return;
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'h') { e.preventDefault(); hide(); return; }
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process') return;
  if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'r') { e.preventDefault(); action('resume'); return; }
  const overlay = app.querySelector('.menu, .toc, .quick-settings');
  if (e.key === 'Escape' && overlay) { closeOverlays(true); e.preventDefault(); return; }
  if (data.type !== 'reader' || !(e.target instanceof Element) || e.target.closest('input,select,textarea,button') || overlay) return;
  if (e.key === 'Escape') { e.preventDefault(); hide(); }
  if (e.key === 'PageDown' || e.key === 'PageUp' || e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === ' ') e.preventDefault();
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); if (e.altKey) action(e.key === 'ArrowRight' ? 'nextChapter' : 'previousChapter'); else if (!e.ctrlKey && !e.metaKey) page(e.key === 'ArrowRight' ? 1 : -1); }
});
window.addEventListener('blur', () => { if (data?.type === 'reader') reportPosition(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && data?.type === 'reader') { closeOverlays(); reportPosition(); } });
api.setState(undefined); send('ready');
