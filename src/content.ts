import { readFile } from 'node:fs/promises';
import { posix } from 'node:path';
import * as yauzl from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { parse } from 'parse5';
import iconv from 'iconv-lite';
import { Content, Section, TocItem } from './model';

export interface Cancellation { readonly isCancellationRequested: boolean }
export function cancelled(token?: Cancellation) { if (token?.isCancellationRequested) throw new Error('已取消导入'); }
const MAX_ENTRY = 20 * 1024 * 1024;
const MAX_TOTAL = 100 * 1024 * 1024;
const BLOCK = 16000;
interface SourceSection { key: string; title: string; text: string; anchors?: Record<string, number> }
interface SourceToc { title: string; key: string; offset: number }

export function createContent(id: string, title: string, author: string, source: SourceSection[], sourceToc: SourceToc[] = []): Content {
  const sections: Section[] = []; const toc: TocItem[] = [];
  const mappings = new Map<string, { start: number; sections: Section[] }>();
  let totalLength = 0;
  for (const chapter of source) {
    if (!chapter.text.trim()) continue;
    const chunks: Section[] = []; const chapterStart = totalLength;
    for (let offset = 0; offset < chapter.text.length;) {
      let end = Math.min(offset + BLOCK, chapter.text.length);
      if (end < chapter.text.length) {
        const newline = chapter.text.lastIndexOf('\n', end);
        if (newline > offset + BLOCK / 2) end = newline + 1;
        if (/[\uDC00-\uDFFF]/.test(chapter.text[end] ?? '')) end--;
      }
      const section = { id: `s${sections.length}`, title: chapter.title, text: chapter.text.slice(offset, end), start: totalLength };
      sections.push(section); chunks.push(section); totalLength += section.text.length; offset = end;
    }
    mappings.set(chapter.key, { start: chapterStart, sections: chunks });
  }
  if (!sections.length) throw new Error('未找到可读正文（图片书或空文件暂不支持）');
  for (const entry of sourceToc) {
    const map = mappings.get(entry.key); if (!map) continue;
    const absolute = map.start + Math.max(0, entry.offset);
    const s = [...map.sections].reverse().find(s => s.start <= absolute) ?? map.sections[0];
    toc.push({ title: entry.title, sectionId: s.id, offset: Math.min(s.text.length, absolute - s.start) });
  }
  if (!toc.length) for (const chapter of source) {
    const map = mappings.get(chapter.key); if (map) toc.push({ title: chapter.title, sectionId: map.sections[0].id, offset: 0 });
  }
  return { version: 1, id, title, author, sections, toc, totalLength };
}

export function decodeTxt(bytes: Buffer, encoding?: string): { text: string; encoding: string; needsPreview: boolean } {
  let selected = encoding?.toLowerCase();
  if (selected && !['utf-8', 'gb18030', 'gbk'].includes(selected)) throw new Error('不支持的 TXT 编码');
  if (!selected) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); selected = 'utf-8'; }
    catch { selected = 'gb18030'; }
  }
  let text: string;
  try { text = selected === 'utf-8' ? new TextDecoder('utf-8', { fatal: true }).decode(bytes) : iconv.decode(bytes, selected); }
  catch { throw new Error('无法按 UTF-8 解码，请选择 GB18030/GBK 或检查文件'); }
  if (text.includes('\0')) throw new Error('TXT 包含二进制内容或使用了暂不支持的编码');
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  return { text, encoding: selected, needsPreview: !encoding && selected !== 'utf-8' };
}

export function txtContent(id: string, title: string, text: string): Content {
  const pattern = /^(?:\s{0,4})(?:第[零〇一二三四五六七八九十百千万两\d]+[章节卷回部篇][^\n]{0,70}|chapter\s+\d+[^\n]{0,70})$/gim;
  const matches = [...text.matchAll(pattern)]; const source: SourceSection[] = [];
  if (!matches.length) source.push({ key: 'text', title: '正文', text });
  else {
    if (matches[0].index! > 0) source.push({ key: 'preface', title: '开篇', text: text.slice(0, matches[0].index) });
    matches.forEach((m, i) => source.push({ key: `chapter${i}`, title: m[0].trim(), text: text.slice(m.index, matches[i + 1]?.index ?? text.length) }));
  }
  return createContent(id, title, '', source);
}

function safePath(path: string, base = ''): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || path.includes('\\') || path.includes('\0')) throw new Error('EPUB 中包含不安全的资源路径');
  const value = posix.normalize(posix.join(base, path));
  if (value === '..' || value.startsWith('../') || value.startsWith('/')) throw new Error('EPUB 资源路径越界');
  return value;
}
function resolveRef(href: string, from: string): { key: string; fragment: string } {
  const [file, fragment = ''] = href.split('#', 2);
  try { return { key: file ? safePath(decodeURIComponent(file), posix.dirname(from)) : from, fragment: decodeURIComponent(fragment) }; }
  catch { throw new Error('EPUB 资源引用无效'); }
}
const array = <T>(value: T | T[] | undefined): T[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const xmlText = (value: any): string => typeof value === 'string' || typeof value === 'number' ? String(value) : String(value?.['#text'] ?? '');
function xml(data: string): any {
  // External DTD declarations in legacy NCX are allowed, never fetched. Internal entities are rejected.
  if (/<!ENTITY/i.test(data) || /<!DOCTYPE[^>]*\[/i.test(data)) throw new Error('不支持包含自定义 XML 实体的 EPUB');
  if (XMLValidator.validate(data) !== true) throw new Error('EPUB XML 文件损坏');
  return new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: true }).parse(data);
}

class Archive {
  private zip!: yauzl.ZipFile;
  private entries = new Map<string, yauzl.Entry>();
  private consumed = 0;
  private cache = new Map<string, string>();
  static async open(file: string, token?: Cancellation): Promise<Archive> {
    const archive = new Archive();
    await new Promise<void>((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new Error('EPUB ZIP 文件损坏或无法打开')); return; }
      archive.zip = zip;
      const fail = (e: Error) => { zip.close(); reject(e); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        try {
          cancelled(token);
          if (archive.entries.size >= 10000) throw new Error('EPUB 条目数量超过限制');
          const key = safePath(entry.fileName);
          if (archive.entries.has(key)) throw new Error('EPUB 存在重复资源路径');
          archive.entries.set(key, entry); zip.readEntry();
        } catch (e) { fail(e as Error); }
      });
      zip.on('end', () => resolve()); zip.readEntry();
    }));
    return archive;
  }
  has(key: string) { return this.entries.has(key); }
  async text(key: string, token?: Cancellation): Promise<string> {
    cancelled(token); if (this.cache.has(key)) return this.cache.get(key)!;
    const entry = this.entries.get(key); if (!entry) throw new Error(`EPUB 缺少正文或必要资源：${key}`);
    if (entry.generalPurposeBitFlag & 1) throw new Error('EPUB ZIP 条目已加密，暂不支持');
    if (entry.uncompressedSize > MAX_ENTRY) throw new Error('EPUB 单个正文资源超过 20 MiB 限制');
    const stream = await new Promise<NodeJS.ReadableStream>((resolve, reject) => this.zip.openReadStream(entry, (error, stream) => error || !stream ? reject(error ?? new Error('无法读取 EPUB')) : resolve(stream)));
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      cancelled(token); size += chunk.length; this.consumed += chunk.length;
      if (size > MAX_ENTRY || this.consumed > MAX_TOTAL) throw new Error('EPUB 实际解压内容超过限制');
      chunks.push(chunk);
    }
    const value = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)); this.cache.set(key, value); return value;
  }
  close() { this.zip.close(); }
}

function attrs(node: any): Record<string, string> { return Object.fromEntries((node.attrs ?? []).map((a: any) => [a.prefix ? `${a.prefix}:${a.name}` : a.name, a.value])); }
function walk(node: any, visit: (node: any) => void) { visit(node); for (const c of node.childNodes ?? []) walk(c, visit); }
function nodeText(node: any): string { return node.nodeName === '#text' ? node.value : (node.childNodes ?? []).map(nodeText).join(''); }
function htmlText(data: string): { text: string; title: string; anchors: Record<string, number> } {
  const tree = parse(data); let body: any; let title = '';
  walk(tree, n => { if (n.nodeName === 'body') body = n; if (!title && /^h[12]$/.test(n.nodeName)) title = nodeText(n).trim(); });
  let text = ''; const anchors: Record<string, number> = {};
  const newline = () => { if (text && !text.endsWith('\n')) text += '\n'; };
  const visit = (n: any) => {
    if (['head', 'script', 'style', 'nav', 'svg', 'noscript'].includes(n.nodeName)) return;
    if (n.nodeName === '#text') { text += n.value.replace(/[\s\u00a0]+/g, ' '); return; }
    const block = /^(p|div|section|h[1-6]|li|blockquote|pre|br|tr|hr)$/.test(n.nodeName);
    if (block) newline();
    const a = attrs(n); if (a.id) anchors[a.id] = text.length; if (a.name) anchors[a.name] = text.length;
    for (const c of n.childNodes ?? []) visit(c);
    if (block) newline();
  };
  visit(body ?? tree);
  return { text: text.trimEnd(), title, anchors };
}

export async function epubContent(file: string, id: string, fallbackTitle: string, token?: Cancellation): Promise<Content> {
  const zip = await Archive.open(file, token);
  try {
    const container = xml(await zip.text('META-INF/container.xml', token));
    const opfPath = safePath(array<any>(container.container?.rootfiles?.rootfile)[0]?.['@_full-path'] ?? '');
    if (!opfPath || opfPath === '.') throw new Error('EPUB 缺少包文件路径');
    const root = xml(await zip.text(opfPath, token)).package;
    if (!root) throw new Error('EPUB 包结构无效');
    const metadata = root.metadata ?? {};
    const metas = array<any>(metadata.meta);
    if (metas.some(m => m['@_property'] === 'rendition:layout' && xmlText(m) === 'pre-paginated' || m['@_name'] === 'fixed-layout' && m['@_content'] === 'true')) throw new Error('首版暂不支持固定版式 EPUB');
    const title = xmlText(array<any>(metadata.title)[0]).trim() || fallbackTitle;
    const author = array<any>(metadata.creator).map(xmlText).filter(Boolean).join(' / ');
    const manifest = new Map<string, any>(array<any>(root.manifest?.item).map(item => [item['@_id'], item]));
    const spine = array<any>(root.spine?.itemref).filter(item => item['@_linear'] !== 'no');
    const encrypted = new Set<string>();
    if (zip.has('META-INF/encryption.xml')) {
      const enc = xml(await zip.text('META-INF/encryption.xml', token));
      const collect = (node: any) => {
        if (!node || typeof node !== 'object') return;
        if (node.CipherReference?.['@_URI']) encrypted.add(safePath(node.CipherReference['@_URI']));
        for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(collect); else if (typeof value === 'object') collect(value);
      }; collect(enc);
    }
    const source: SourceSection[] = [];
    for (const ref of spine) {
      cancelled(token); const item = manifest.get(ref['@_idref']); if (!item) throw new Error('EPUB 阅读顺序引用了不存在的正文');
      if (!['application/xhtml+xml', 'text/html'].includes(item['@_media-type'])) continue;
      const key = resolveRef(item['@_href'], opfPath).key;
      if (encrypted.has(key)) throw new Error('EPUB 正文受 DRM 或加密保护，暂不支持');
      const body = htmlText(await zip.text(key, token)); source.push({ key, title: body.title || `正文 ${source.length + 1}`, text: body.text, anchors: body.anchors });
      await new Promise<void>(r => setImmediate(r));
    }
    const toc: SourceToc[] = [];
    const add = (title: string, href: string, from: string) => {
      if (!href) return;
      const target = resolveRef(href, from); const chapter = source.find(s => s.key === target.key);
      if (chapter && title.trim()) toc.push({ title: title.trim(), key: chapter.key, offset: chapter.anchors?.[target.fragment] ?? 0 });
    };
    const navItem = [...manifest.values()].find(item => String(item['@_properties'] ?? '').split(/\s+/).includes('nav'));
    if (navItem) {
      const path = resolveRef(navItem['@_href'], opfPath).key; const navTree = parse(await zip.text(path, token));
      let tocNav: any;
      walk(navTree, n => { const a = attrs(n); if (n.nodeName === 'nav' && /\btoc\b/.test(a['epub:type'] ?? a.role ?? '')) tocNav = n; });
      if (tocNav) walk(tocNav, n => { if (n.nodeName === 'a') add(nodeText(n), attrs(n).href, path); });
    }
    if (!toc.length) {
      const ncx = manifest.get(root.spine?.['@_toc']) ?? [...manifest.values()].find(item => item['@_media-type'] === 'application/x-dtbncx+xml');
      if (ncx) {
        const path = resolveRef(ncx['@_href'], opfPath).key;
        const visit = (points: any) => { for (const p of array<any>(points)) { add(xmlText(p.navLabel?.text), p.content?.['@_src'], path); visit(p.navPoint); } };
        visit(xml(await zip.text(path, token)).ncx?.navMap?.navPoint);
      }
    }
    return createContent(id, title, author, source, toc);
  } finally { zip.close(); }
}

export async function parseBook(file: string, format: 'txt' | 'epub', id: string, title: string, encoding?: string, token?: Cancellation): Promise<{ content: Content; encoding?: string }> {
  cancelled(token);
  if (format === 'epub') return { content: await epubContent(file, id, title, token) };
  const decoded = decodeTxt(await readFile(file), encoding); cancelled(token);
  return { content: txtContent(id, title, decoded.text), encoding: decoded.encoding };
}
