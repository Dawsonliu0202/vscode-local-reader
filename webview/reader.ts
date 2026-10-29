import type { Chapter, Position } from '../src/model';

export interface ReaderPayload {
  bookId: string; title: string; mode: string; position: Position; absolutePosition: number;
  chapter: Chapter & { text: string }; settings: { fontSize: number; lineHeight: number; fontFamily: string };
}
interface Page { offset: number; chunkStart: number; chunkEnd: number; column: number }
interface Callbacks { send(type: string, extra?: Record<string, unknown>): void; activity(): void; ready(): void }
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const safeOffset = (text: string, offset: number) => offset > 0 && /[\uDC00-\uDFFF]/.test(text[offset] ?? '') ? offset - 1 : offset;
let cached: { key: string; pages: Page[] } | undefined;

function dimensions(flow: HTMLElement, width: number, height: number) {
  flow.style.width = `${width}px`; flow.style.height = `${height}px`; flow.style.columnWidth = `${width}px`;
}

// Layout bounded text chunks with native CSS columns. Keep the final partial
// page for the next chunk so a storage chunk never creates an artificial page.
async function paginate(text: string, measure: HTMLElement, width: number, cancelled: () => boolean): Promise<Page[] | undefined> {
  const result: Page[] = []; let start = 0;
  while (start < text.length) {
    if (cancelled()) return;
    let span = 16384, end = safeOffset(text, Math.min(text.length, start + span));
    let offsets: number[] = [];
    while (true) {
      const chunk = text.slice(start, end); measure.textContent = chunk;
      const count = Math.max(1, Math.ceil(measure.scrollWidth / width));
      const node = measure.firstChild!; const base = measure.getBoundingClientRect().left;
      const range = document.createRange(); offsets = [0];
      const columnAt = (offset: number) => {
        const at = safeOffset(chunk, offset); range.setStart(node, at); range.setEnd(node, Math.min(chunk.length, at + (chunk.codePointAt(at)! > 0xffff ? 2 : 1)));
        const rect = range.getBoundingClientRect();
        return Math.floor((rect.left - base + Math.max(0.01, rect.width / 2)) / width);
      };
      for (let page = 1; page < count; page++) {
        let low = offsets.at(-1)!, high = chunk.length;
        while (low < high) { const middle = Math.floor((low + high) / 2); if (columnAt(middle) < page) low = middle + 1; else high = middle; }
        const offset = safeOffset(chunk, low);
        if (offset >= chunk.length || offset <= offsets.at(-1)!) break;
        offsets.push(offset);
        if (page % 64 === 0) { await frame(); if (cancelled()) return; }
      }
      if (offsets.length > 1 || end === text.length) break;
      span *= 2; end = safeOffset(text, Math.min(text.length, start + span));
    }
    const complete = end === text.length ? offsets.length : offsets.length - 1;
    for (let i = 0; i < complete; i++) result.push({ offset: start + offsets[i], chunkStart: start, chunkEnd: end, column: i });
    start = end === text.length ? end : start + offsets.at(-1)!;
    await frame();
  }
  return result;
}

export class ReaderView {
  readonly viewport = document.createElement('main');
  private readonly window = document.createElement('div');
  private readonly flow = document.createElement('div');
  private readonly measure = document.createElement('div');
  private readonly footer = document.createElement('footer');
  private readonly observer: ResizeObserver;
  private pages: Page[] = []; private pageIndex = 0; private generation = 0; private signature = '';
  private anchor: number; private atEnd: boolean; private shouldFocus: boolean;
  constructor(private readonly root: HTMLElement, private readonly data: ReaderPayload, private readonly callbacks: Callbacks) {
    this.anchor = data.absolutePosition; this.atEnd = data.position.atEnd; this.shouldFocus = document.hasFocus();
    this.viewport.className = 'viewport'; this.viewport.tabIndex = 0; this.viewport.setAttribute('aria-label', '正文');
    this.viewport.style.fontSize = `${data.settings.fontSize}px`; this.viewport.style.lineHeight = String(data.settings.lineHeight); this.viewport.style.fontFamily = data.settings.fontFamily;
    this.window.className = 'page-window'; this.flow.className = 'page-flow'; this.measure.className = 'page-flow page-measure'; this.measure.setAttribute('aria-hidden', 'true');
    this.window.append(this.flow, this.measure); this.viewport.append(this.window);
    this.footer.className = 'page-counter'; this.footer.setAttribute('aria-label', '本章页码'); this.footer.title = '本章页码'; this.footer.textContent = '…';
    root.append(this.viewport, this.footer); document.body.classList.add('reader-active');
    this.viewport.addEventListener('wheel', e => e.preventDefault(), { passive: false });
    let press: { id: number; x: number; y: number; dragged: boolean; selected: boolean } | undefined;
    this.viewport.addEventListener('pointerdown', e => {
      callbacks.activity();
      press = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, dragged: false, selected: window.getSelection()?.isCollapsed === false } : undefined;
    });
    this.viewport.addEventListener('pointermove', e => {
      if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) press.dragged = true;
    });
    this.viewport.addEventListener('pointercancel', () => { press = undefined; });
    this.viewport.addEventListener('click', e => {
      const start = press; press = undefined;
      if (!start || start.dragged || start.selected || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented || window.getSelection()?.isCollapsed === false || this.root.querySelector('.menu, .toc')) return;
      const bounds = this.viewport.getBoundingClientRect(), x = e.clientX - bounds.left;
      if (x < bounds.width / 3) this.page(-1);
      else if (x >= bounds.width * 2 / 3) this.page(1);
    });
    this.observer = new ResizeObserver(() => { void this.layout(); }); this.observer.observe(this.window);
  }
  private async layout() {
    const width = Math.floor(this.window.clientWidth), height = Math.floor(this.window.clientHeight);
    if (width < 40 || height < this.data.settings.fontSize * this.data.settings.lineHeight) { ++this.generation; this.signature = ''; this.pages = []; this.footer.textContent = '请增大阅读区域'; return; }
    const style = getComputedStyle(this.viewport);
    const key = JSON.stringify([this.data.bookId, this.data.chapter.start, this.data.chapter.end, width, height, style.fontFamily, style.fontSize, style.lineHeight]);
    if (key === this.signature) return;
    this.signature = key; const generation = ++this.generation; this.pages = []; this.footer.textContent = '…';
    dimensions(this.flow, width, height); dimensions(this.measure, width, height);
    await document.fonts.ready; if (generation !== this.generation) return;
    const pages = cached?.key === key ? cached.pages : await paginate(this.data.chapter.text, this.measure, width, () => generation !== this.generation);
    if (!pages || generation !== this.generation) return;
    this.measure.textContent = ''; this.pages = pages; cached = { key, pages };
    const offset = Math.max(0, this.anchor - this.data.chapter.start);
    this.pageIndex = pages.length - 1; while (this.pageIndex > 0 && pages[this.pageIndex].offset > offset) this.pageIndex--;
    this.show(); if (this.shouldFocus) { this.focus(); this.shouldFocus = false; } this.callbacks.ready();
  }
  private show() {
    const page = this.pages[this.pageIndex]; if (!page) return;
    const start = String(page.chunkStart), end = String(page.chunkEnd);
    if (this.flow.dataset.start !== start || this.flow.dataset.end !== end) {
      this.flow.textContent = this.data.chapter.text.slice(page.chunkStart, page.chunkEnd); this.flow.dataset.start = start; this.flow.dataset.end = end;
    }
    this.flow.style.transform = `translateX(${-page.column * this.window.clientWidth}px)`;
    this.footer.textContent = `${this.pageIndex + 1} / ${this.pages.length}`;
    this.footer.dataset.pageStart = String(this.data.chapter.start + page.offset);
    this.footer.dataset.pageEnd = String(this.data.chapter.start + (this.pages[this.pageIndex + 1]?.offset ?? this.data.chapter.text.length));
    const previous = this.root.querySelector<HTMLButtonElement>('[data-page="previous"]'), next = this.root.querySelector<HTMLButtonElement>('[data-page="next"]');
    if (previous) previous.disabled = this.pageIndex === 0 && this.data.chapter.index === 0;
    if (next) next.disabled = this.atEnd && this.pageIndex === this.pages.length - 1 && this.data.chapter.index === this.data.chapter.count - 1;
  }
  page(direction: number) {
    if (!this.pages.length) return;
    this.callbacks.activity(); const target = this.pageIndex + direction;
    if (target >= 0 && target < this.pages.length) {
      this.pageIndex = target; this.anchor = this.data.chapter.start + this.pages[target].offset;
      this.atEnd = direction > 0 && target === this.pages.length - 1 && this.data.chapter.index === this.data.chapter.count - 1;
      if (this.atEnd) this.anchor = this.data.chapter.end;
      this.reportPosition(); this.show(); this.focus();
    } else if (direction < 0 && this.data.chapter.index > 0 || direction > 0 && this.data.chapter.index < this.data.chapter.count - 1) {
      this.reportPosition(); this.callbacks.send('chapterEdge', { direction });
    } else if (direction > 0) { this.atEnd = true; this.anchor = this.data.chapter.end; this.reportPosition(); this.show(); }
  }
  reportPosition() { this.data.absolutePosition = this.anchor; this.callbacks.send('pagePosition', { absolute: this.anchor, atEnd: this.atEnd }); }
  focus() { this.viewport.focus({ preventScroll: true }); }
  dispose() { ++this.generation; this.observer.disconnect(); document.body.classList.remove('reader-active'); }
}
