export type Mode = 'sidebar' | 'editor' | 'panel';
export interface ReaderPreferences { fontSize: number; lineHeight: number; panelReaderSide: 'left' | 'right' }
export const defaultPreferences: ReaderPreferences = { fontSize: 0, lineHeight: 1.8, panelReaderSide: 'right' };
export function validatePreferences(value: unknown): ReaderPreferences {
  const v = value as ReaderPreferences;
  if (!v || !Number.isInteger(v.fontSize) || (v.fontSize !== 0 && (v.fontSize < 8 || v.fontSize > 40))) throw new Error('字号应为 8–40 的整数，或选择跟随编辑器');
  if (!Number.isFinite(v.lineHeight) || v.lineHeight < 1.2 || v.lineHeight > 3) throw new Error('行高应在 1.2–3.0 之间');
  if (v.panelReaderSide !== 'left' && v.panelReaderSide !== 'right') throw new Error('请选择有效的底部布局');
  return { fontSize: v.fontSize, lineHeight: Math.round(v.lineHeight * 10) / 10, panelReaderSide: v.panelReaderSide };
}
export interface Position { sectionId: string; offset: number; atEnd: boolean }
export interface Section { id: string; title: string; text: string; start: number }
export interface TocItem { title: string; sectionId: string; offset: number }
export interface Content { version: 1; id: string; title: string; author: string; sections: Section[]; toc: TocItem[]; totalLength: number }
export interface Chapter { title: string; start: number; end: number; index: number; count: number; tocIndex: number }
export function chapters(content: Content): Chapter[] {
  const entries = new Map<number, { title: string; tocIndex: number }>();
  for (const [tocIndex, item] of content.toc.entries()) {
    const s = content.sections.find(s => s.id === item.sectionId);
    if (s && item.offset >= 0 && item.offset < s.text.length) entries.set(s.start + item.offset, { title: item.title, tocIndex });
  }
  if (!entries.has(0)) entries.set(0, { title: content.sections[0]?.title || '正文', tocIndex: -1 });
  const sorted = [...entries].sort((a, b) => a[0] - b[0]).filter(([start]) => start < content.totalLength);
  return sorted.map(([start, entry], index) => ({ ...entry, start, end: sorted[index + 1]?.[0] ?? content.totalLength, index, count: sorted.length }));
}
export function absolutePosition(content: Content, position: Position): number {
  return position.atEnd ? content.totalLength : (content.sections.find(s => s.id === position.sectionId)?.start ?? 0) + position.offset;
}
export function positionAt(content: Content, absolute: number, atEnd = false): Position {
  const offset = Math.max(0, Math.min(content.totalLength, Math.floor(absolute)));
  const section = [...content.sections].reverse().find(s => s.start <= offset) ?? content.sections[0];
  return clampPosition(content, { sectionId: section.id, offset: offset - section.start, atEnd: atEnd && offset === content.totalLength });
}
export function chapterAt(content: Content, position: Position): Chapter {
  const list = chapters(content), absolute = absolutePosition(content, position);
  return [...list].reverse().find(c => c.start <= absolute) ?? list[0];
}
export interface Book {
  id: string; format: 'txt' | 'epub'; title: string; displayTitle: string; author: string;
  importedAt: number; encoding?: string; lastReadAt: number; position: Position;
  totalLength: number; sectionIndex: { id: string; start: number; length: number }[]; positionUpdatedAt: number;
}
export interface Session {
  id: string; owner: string; bookId: string; startedAt: number; endedAt?: number; checkpointAt: number;
  startPosition: Position; endPosition: Position; days: Record<string, number>;
}
export interface State { schemaVersion: 1; books: Record<string, Book>; sessions: Record<string, Session>; lastBookId?: string; mode: Mode }
export const emptyState = (): State => ({ schemaVersion: 1, books: {}, sessions: {}, mode: 'sidebar' });
export const isId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
export function clampPosition(content: Pick<Content, 'sections'>, raw?: Partial<Position>): Position {
  const s = content.sections.find(s => s.id === raw?.sectionId) ?? content.sections[0];
  if (!s) throw new Error('书籍没有可读正文');
  let offset = Math.max(0, Math.min(s.text.length, Math.floor(Number(raw?.offset) || 0)));
  if (offset > 0 && /[\uDC00-\uDFFF]/.test(s.text[offset] ?? '')) offset--;
  return { sectionId: s.id, offset, atEnd: !!raw?.atEnd && s === content.sections.at(-1) };
}
export function progress(book: Book, position = book.position): number {
  if (position.atEnd) return 100;
  const section = book.sectionIndex.find(s => s.id === position.sectionId);
  return section ? Math.min(99.9, Math.max(0, (section.start + position.offset) / Math.max(1, book.totalLength) * 100)) : 0;
}
export const sessionSeconds = (s: Session): number => Object.values(s.days).reduce((a, b) => a + b, 0);
export interface ReadingRecord { id: string; bookId: string; date: string; seconds: number; startedAt: number; endedAt: number; startPosition: Position; endPosition: Position; progressExact: boolean }
export function readingRecords(state: State): ReadingRecord[] {
  const groups = new Map<string, ReadingRecord>();
  for (const s of Object.values(state.sessions)) {
    if (!state.books[s.bookId]) continue;
    // Historical cross-midnight sessions have daily seconds but only session-wide
    // positions. Keep their duration without inventing daily progress snapshots.
    const progressExact = Object.values(s.days).filter(seconds => seconds > 0).length === 1;
    for (const [date, seconds] of Object.entries(s.days)) {
      if (seconds <= 0) continue;
      const day = new Date(`${date}T00:00:00`), next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      const startedAt = Math.max(s.startedAt, +day), endedAt = Math.min(s.endedAt ?? s.checkpointAt, +next);
      const id = `${s.bookId}:${date}`, group = groups.get(id);
      if (!group) groups.set(id, { id, bookId: s.bookId, date, seconds, startedAt, endedAt, startPosition: s.startPosition, endPosition: s.endPosition, progressExact });
      else {
        group.seconds += seconds;
        group.progressExact &&= progressExact;
        if (startedAt < group.startedAt) { group.startedAt = startedAt; group.startPosition = s.startPosition; }
        if (endedAt >= group.endedAt) { group.endedAt = endedAt; group.endPosition = s.endPosition; }
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.endedAt - a.endedAt);
}
export function localDate(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function statistics(state: State, now = Date.now()) {
  const days: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days[localDate(+d)] = 0; }
  const perBook: Record<string, number> = {};
  let total = 0;
  for (const s of Object.values(state.sessions)) {
    if (!state.books[s.bookId]) continue;
    const seconds = sessionSeconds(s); total += seconds; perBook[s.bookId] = (perBook[s.bookId] ?? 0) + seconds;
    for (const [date, seconds] of Object.entries(s.days)) if (date in days) days[date] += seconds;
  }
  return { today: days[localDate(now)] ?? 0, total, days, perBook };
}
