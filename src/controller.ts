import * as vscode from 'vscode';
import { readFile, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { Storage } from './storage';
import { Tracker } from './tracker';
import { absolutePosition, Book, chapterAt, chapters, clampPosition, Content, isId, Mode, Position, positionAt, progress, ReaderPreferences, readingRecords, statistics, validatePreferences } from './model';
import { decodeTxt } from './content';
import { webviewHtml } from './webview';

interface Surface { webview: vscode.Webview; visible(): boolean; dispose?: () => void }
type Screen = 'hidden' | 'reader' | 'library' | 'statistics' | 'settings';
export class ReaderController implements vscode.Disposable {
  readonly storage: Storage;
  private readonly tracker = new Tracker();
  private readonly surfaces = new Map<string, Surface>();
  private views = new Map<string, vscode.WebviewView>();
  private editor?: vscode.WebviewPanel;
  private relocatingPanel = false;
  private active = ''; private screen: Screen = 'hidden'; private mode: Mode = 'sidebar';
  private book?: Book; private content?: Content; private position?: Position;
  private token = randomUUID(); private epoch = 0; private positionAt = 0;
  private checkpointTimer: NodeJS.Timeout; private tickTimer: NodeJS.Timeout;
  private positionTimer?: NodeJS.Timeout; private pendingPosition?: { book: Book; position: Position; at: number };
  private importing = false; private savingError = false;
  private importCancellation?: vscode.CancellationTokenSource;
  private rendered?: { key: string; screen: Screen };
  private dialogs = new Set<vscode.CancellationTokenSource>();
  private updatingSettings = false;
  private layoutQueue: Promise<void> = Promise.resolve();
  private ready: Promise<void>;
  constructor(private readonly context: vscode.ExtensionContext) {
    this.storage = new Storage(context.globalStorageUri.fsPath);
    this.ready = this.storage.init().then(s => { this.mode = s.mode; if (this.storage.recovered) void vscode.window.showWarningMessage('Local Reader 已从上一份完整备份恢复书架。'); });
    this.ready.catch(() => undefined);
    this.tickTimer = setInterval(() => this.tracker.tick(), 1000);
    this.checkpointTimer = setInterval(() => this.report(this.checkpoint()), 10000);
    context.subscriptions.push(vscode.window.onDidChangeWindowState(s => {
      this.tracker.setFocused(s.focused); this.report(this.checkpoint());
    }), vscode.workspace.onDidChangeConfiguration(e => {
      if (this.updatingSettings) return;
      if (e.affectsConfiguration('localReader.panelReaderSide') && this.screen === 'reader' && this.mode === 'panel') this.report(this.positionPanelReader());
      if (e.affectsConfiguration('localReader') || e.affectsConfiguration('editor.fontSize') || e.affectsConfiguration('editor.fontFamily')) this.renderReader();
      if (this.screen === 'settings') this.report(this.renderManagement());
    }));
    this.tracker.setFocused(vscode.window.state.focused);
  }
  private report(promise: Promise<unknown>) { void promise.catch(e => this.error(e)); }
  private error(e: unknown) { if (!this.savingError) { this.savingError = true; void vscode.window.showErrorMessage(`Local Reader：${e instanceof Error ? e.message : String(e)}`).then(() => { this.savingError = false; }); } }
  async run(action: () => unknown | Promise<unknown>) { try { await this.ready; await action(); } catch (e) { this.error(e); } }
  provider(key: 'sidebar' | 'panel' | 'library'): vscode.WebviewViewProvider {
    return { resolveWebviewView: view => {
      this.views.set(key, view); this.bind(key, view.webview, () => view.visible);
      view.onDidChangeVisibility(() => {
        if (key === 'library' && view.visible && this.active !== 'library') { this.report(this.run(() => this.management('library'))); return; }
        if (this.active === key) { if (!view.visible) this.rendered = undefined; this.tracker.setVisible(this.readingVisible()); if (view.visible) this.renderReader(); else this.report(this.checkpoint()); }
        if (key === 'library' && view.visible && this.active === 'library') this.report(this.renderManagement());
      }, undefined, this.context.subscriptions);
      view.onDidDispose(() => {
        if (this.views.get(key) !== view) return;
        this.views.delete(key); this.surfaces.delete(key);
        if (this.active === key && !this.relocatingPanel) this.report(this.hide());
      }, undefined, this.context.subscriptions);
      if (key === 'library' && view.visible && this.active !== 'library') this.report(this.run(() => this.management('library')));
    } };
  }
  private bind(key: string, webview: vscode.Webview, visible: () => boolean, dispose?: () => void) {
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')] };
    this.surfaces.set(key, { webview, visible, dispose }); webview.html = webviewHtml(webview, this.context.extensionUri);
    webview.onDidReceiveMessage(message => this.report(this.message(key, message)), undefined, this.context.subscriptions);
  }
  private send(key: string, message: unknown) { const s = this.surfaces.get(key); if (s) void s.webview.postMessage(message); }
  private conceal() {
    this.token = randomUUID(); this.tracker.setVisible(false); this.rendered = undefined;
    for (const dialog of this.dialogs) dialog.cancel();
    for (const s of this.surfaces.values()) {
      // Replacing HTML also scrubs webviews that were suspended and could miss postMessage.
      s.webview.html = webviewHtml(s.webview, this.context.extensionUri);
    }
    void vscode.commands.executeCommand('setContext', 'localReader.visible', false);
  }
  private async flushPosition() {
    if (this.positionTimer) clearTimeout(this.positionTimer); this.positionTimer = undefined;
    const pending = this.pendingPosition; this.pendingPosition = undefined;
    if (pending) {
      try { await this.storage.position(pending.book, pending.position, pending.at); }
      catch (e) { if (!this.pendingPosition) this.pendingPosition = pending; throw e; }
    }
  }
  private async checkpoint() {
    await this.flushPosition(); const snapshot = this.tracker.snapshot(); const book = this.book;
    if (snapshot && book) await this.storage.saveSession(snapshot, book);
  }
  private endSession(): Promise<unknown> {
    const session = this.tracker.end(), book = this.book;
    return this.flushPosition().then(() => session && book ? this.storage.saveSession(session, book) : undefined);
  }
  async hide() {
    const libraryWasActive = this.active === 'library' && this.views.get('library')?.visible;
    ++this.epoch; this.importCancellation?.cancel(); this.screen = 'hidden'; this.conceal(); this.active = '';
    const end = this.endSession(); this.book = undefined; this.content = undefined;
    const editor = this.editor; this.editor = undefined; editor?.dispose();
    await vscode.commands.executeCommand('setContext', 'localReader.panelActive', false);
    if (libraryWasActive) await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await end;
  }
  async resume() {
    await this.ready; const s = await this.storage.read();
    const book = s.lastBookId && s.books[s.lastBookId] || Object.values(s.books).sort((a, b) => b.lastReadAt - a.lastReadAt || b.importedAt - a.importedAt)[0];
    if (book) await this.openBook(book.id); else await this.management('library');
  }
  async openBook(id: string, requestedMode?: Mode) {
    await this.ready; if (!isId(id)) return;
    const continueSession = this.book?.id === id && !!this.tracker.session;
    const epoch = ++this.epoch; this.screen = 'hidden'; this.conceal();
    if (continueSession) await this.checkpoint(); else await this.endSession();
    const state = await this.storage.read(); const book = state.books[id]; if (!book) throw new Error('该书已被移除，请刷新书架');
    const content = await this.storage.content(book); if (epoch !== this.epoch) return;
    this.book = book; this.content = content; this.position = clampPosition(content, book.position); this.positionAt = Date.now();
    this.mode = requestedMode ?? state.mode; this.screen = 'reader'; this.token = randomUUID();
    if (!continueSession) this.tracker.start({ ...book, position: this.position });
    await this.showSurface(this.mode, epoch); if (epoch !== this.epoch) return;
    this.schedulePosition(this.position); this.tracker.activity(); this.renderReader();
    void vscode.commands.executeCommand('setContext', 'localReader.visible', true);
  }
  private async showSurface(mode: Mode, epoch: number) {
    if (mode !== 'editor' && this.editor) { const p = this.editor; this.editor = undefined; p.dispose(); }
    this.active = mode;
    if (mode !== 'sidebar' && this.views.get('library')?.visible) await vscode.commands.executeCommand('workbench.action.closeSidebar');
    if (mode !== 'panel') await vscode.commands.executeCommand('setContext', 'localReader.panelActive', false);
    if (epoch !== this.epoch) return;
    if (mode === 'editor') {
      if (!this.editor) {
        const panel = vscode.window.createWebviewPanel('localReader.editor', 'notes.log', vscode.ViewColumn.Active, { enableScripts: true }); this.editor = panel;
        this.bind('editor', panel.webview, () => panel.visible, () => panel.dispose());
        let wasVisible = panel.visible;
        panel.onDidChangeViewState(() => { if (this.active === 'editor') { if (!panel.visible) this.rendered = undefined; this.tracker.setVisible(this.readingVisible()); if (panel.visible && !wasVisible) this.renderReader(); else if (!panel.visible) this.report(this.checkpoint()); } wasVisible = panel.visible; }, undefined, this.context.subscriptions);
        panel.onDidDispose(() => { this.surfaces.delete('editor'); if (this.editor === panel) { this.editor = undefined; if (this.active === 'editor') this.report(this.hide()); } }, undefined, this.context.subscriptions);
      } else this.editor.reveal();
    } else {
      if (mode === 'panel') {
        this.relocatingPanel = true;
        try {
          // Move only our view. The native Terminal view and its processes remain owned by VS Code.
          await vscode.commands.executeCommand('setContext', 'localReader.panelActive', true);
          if (epoch !== this.epoch) return;
          await vscode.commands.executeCommand('workbench.action.positionPanelBottom');
          if (epoch !== this.epoch) return;
          await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['localReader.panel'], destinationId: 'terminal' });
          if (epoch !== this.epoch) return;
          await vscode.commands.executeCommand('workbench.action.terminal.focus');
        } finally { this.relocatingPanel = false; }
      }
      if (epoch !== this.epoch) return;
      await vscode.commands.executeCommand(`localReader.${mode}.focus`);
      if (epoch !== this.epoch) return;
      this.views.get(mode)?.show(false);
      if (mode === 'panel') await this.positionPanelReader();
    }
    if (epoch !== this.epoch) return;
    this.tracker.setVisible(this.readingVisible());
  }
  private readingVisible() { return this.screen === 'reader' && this.rendered?.key === this.active && this.rendered.screen === 'reader' && !!this.surfaces.get(this.active)?.visible(); }
  private readerSettings() {
    const c = vscode.workspace.getConfiguration('localReader'), editor = vscode.workspace.getConfiguration('editor');
    return { fontSize: c.get<number>('fontSize', 0) || editor.get<number>('fontSize', 14), lineHeight: c.get<number>('lineHeight', 1.8), fontFamily: 'var(--vscode-font-family, sans-serif)' };
  }
  preferences(): ReaderPreferences {
    const c = vscode.workspace.getConfiguration('localReader');
    return { fontSize: c.get<number>('fontSize', 0), lineHeight: c.get<number>('lineHeight', 1.8), panelReaderSide: c.get<'left' | 'right'>('panelReaderSide', 'right') };
  }
  private positionPanelReader(): Promise<void> {
    const epoch = this.epoch;
    const work = this.layoutQueue.catch(() => undefined).then(async () => {
      if (epoch !== this.epoch || this.screen !== 'reader' || this.active !== 'panel' || !this.surfaces.get('panel')?.visible()) return;
      // The reader iframe lives outside its pane DOM. Use the native Terminal's
      // stable focus context to move it to the opposite side, then return focus.
      await vscode.commands.executeCommand('workbench.action.terminal.focus');
      if (epoch !== this.epoch || this.active !== 'panel') return;
      await vscode.commands.executeCommand(this.preferences().panelReaderSide === 'right' ? 'views.moveViewLeft' : 'views.moveViewRight');
      if (epoch === this.epoch && this.active === 'panel') await vscode.commands.executeCommand('localReader.panel.focus');
    });
    this.layoutQueue = work; return work;
  }
  async updatePreferences(raw: unknown) {
    const values = validatePreferences(raw), c = vscode.workspace.getConfiguration('localReader');
    this.updatingSettings = true;
    try {
      for (const key of ['fontSize', 'lineHeight', 'panelReaderSide'] as const) if (c.get(key) !== values[key]) await c.update(key, values[key], vscode.ConfigurationTarget.Global);
    } finally { this.updatingSettings = false; }
    if (this.screen === 'reader' && this.mode === 'panel') await this.positionPanelReader();
    this.renderReader();
    if (this.screen === 'settings') await this.renderManagement();
  }
  private renderReader() {
    if (this.screen !== 'reader' || !this.content || !this.book || !this.position) return;
    const chapter = chapterAt(this.content, this.position);
    const text = this.content.sections.filter(s => s.start < chapter.end && s.start + s.text.length > chapter.start).map(s => s.text.slice(Math.max(0, chapter.start - s.start), chapter.end - s.start)).join('');
    this.send(this.active, { type: 'reader', token: this.token, mode: this.mode, bookId: this.book.id, title: this.book.displayTitle,
      position: this.position, absolutePosition: absolutePosition(this.content, this.position), chapter: { ...chapter, text },
      toc: this.content.toc, progress: progress(this.book, this.position), settings: this.readerSettings() });
  }
  private schedulePosition(position: Position) {
    if (!this.book) return;
    this.position = position; this.book.position = position; this.tracker.position(position);
    this.positionAt = Date.now(); this.pendingPosition = { book: this.book, position: { ...position }, at: this.positionAt };
    if (this.positionTimer) clearTimeout(this.positionTimer);
    this.positionTimer = setTimeout(() => this.report(this.flushPosition()), 300);
  }
  async modePicker() {
    const mode = await this.input(token => vscode.window.showQuickPick([{ label: '侧边栏', mode: 'sidebar' }, { label: '文件标签页', mode: 'editor' }, { label: '底部终端 + 阅读分栏', mode: 'panel' }], { placeHolder: '选择阅读模式' }, token));
    if (mode) await this.switchMode(mode.mode as Mode);
  }
  private async input<T>(show: (token: vscode.CancellationToken) => Thenable<T>): Promise<T> {
    const source = new vscode.CancellationTokenSource(); this.dialogs.add(source);
    try { return await show(source.token); } finally { this.dialogs.delete(source); source.dispose(); }
  }
  async switchMode(mode: Mode) {
    if (!['sidebar', 'editor', 'panel'].includes(mode)) return;
    const epoch = ++this.epoch; await this.flushPosition();
    if (epoch !== this.epoch) return;
    await this.storage.update(s => { s.mode = mode; }); if (epoch !== this.epoch) return;
    this.mode = mode;
    if (this.screen !== 'reader') return;
    this.conceal(); await this.showSurface(mode, epoch); if (epoch !== this.epoch) return;
    this.tracker.activity(); this.renderReader(); void vscode.commands.executeCommand('setContext', 'localReader.visible', true);
  }
  async navigate(action: string) {
    if (this.screen !== 'reader' || !this.content || !this.position) return;
    if (action === 'nextPage' || action === 'previousPage') { this.send(this.active, { type: 'navigate', action }); return; }
    if (action === 'toc') { this.send(this.active, { type: 'toc' }); return; }
    const current = chapterAt(this.content, this.position), list = chapters(this.content);
    const target = list[current.index + (action === 'nextChapter' ? 1 : -1)];
    if (target) this.jump(positionAt(this.content, target.start));
  }
  private jump(raw: Partial<Position>) { if (!this.content) return; this.tracker.activity(); this.schedulePosition(clampPosition(this.content, raw)); this.renderReader(); }
  async management(screen: 'library' | 'statistics' | 'settings') {
    await this.ready; const epoch = ++this.epoch; this.conceal(); this.screen = screen; this.active = 'library'; await this.checkpoint();
    if (epoch !== this.epoch) return;
    if (this.editor) { const p = this.editor; this.editor = undefined; p.dispose(); }
    await vscode.commands.executeCommand('setContext', 'localReader.panelActive', false);
    if (epoch !== this.epoch) return;
    await vscode.commands.executeCommand('localReader.libraryView.focus');
    if (epoch !== this.epoch) return;
    this.views.get('library')?.show(false); this.token = randomUUID();
    await this.renderManagement(); void vscode.commands.executeCommand('setContext', 'localReader.visible', true);
  }
  private async renderManagement() {
    const epoch = this.epoch;
    if (this.screen === 'settings') {
      this.send('library', { type: 'settings', token: this.token, values: this.preferences(), effective: this.readerSettings(), hasBook: !!this.book }); return;
    }
    const state = await this.storage.read(); if (epoch !== this.epoch || !['library', 'statistics'].includes(this.screen)) return;
    this.send('library', { type: this.screen, token: this.token, books: Object.values(state.books).sort((a, b) => b.lastReadAt - a.lastReadAt || b.importedAt - a.importedAt).map(b => ({ ...b, progress: progress(b) })),
      statistics: statistics(state), records: readingRecords(state).map(r => ({ ...r, startProgress: progress(state.books[r.bookId], r.startPosition), endProgress: progress(state.books[r.bookId], r.endPosition) })) });
  }
  async importBooks() {
    if (this.importing) return; this.importing = true; const epoch = this.epoch;
    const cancellation = this.importCancellation = new vscode.CancellationTokenSource();
    try {
      const uris = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { '电子书 EPUB / TXT': ['epub', 'txt'] }, openLabel: '导入书籍' }); if (!uris || cancellation.token.isCancellationRequested) return;
      const results: string[] = [];
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '导入电子书', cancellable: true }, async (p, token) => {
        const combined = { get isCancellationRequested() { return token.isCancellationRequested || cancellation.token.isCancellationRequested; } };
        for (const uri of uris) {
          if (combined.isCancellationRequested) break;
          p.report({ message: path.basename(uri.fsPath), increment: 100 / uris.length });
          try {
            let encoding: string | undefined;
            if (path.extname(uri.fsPath).toLowerCase() === '.txt') {
              if ((await stat(uri.fsPath)).size > 50 * 1024 * 1024) throw new Error('文件超过 50 MiB 限制');
              const bytes = await readFile(uri.fsPath); if (bytes.length > 50 * 1024 * 1024) throw new Error('文件超过 50 MiB 限制');
              const decoded = decodeTxt(bytes);
              if (decoded.needsPreview) {
                const selected = await this.input(inputToken => vscode.window.showQuickPick(['gb18030', 'gbk', 'utf-8'].map(value => {
                  let detail: string; try { detail = decodeTxt(bytes.subarray(0, Math.min(bytes.length, 4000)), value).text.slice(0, 500).replace(/\n/g, ' '); } catch { detail = '此编码无法解码文件'; }
                  return { label: value.toUpperCase(), description: value === 'gb18030' ? '建议' : '', detail, value };
                }), { title: '确认 TXT 编码与正文预览', placeHolder: '选择文字正常的编码；Esc 取消此文件', matchOnDetail: true }, inputToken));
                if (!selected) { results.push(`${path.basename(uri.fsPath)}：已取消`); continue; } encoding = selected.value;
              }
            }
            const result = await this.storage.importFile(uri.fsPath, encoding, combined); results.push(`${path.basename(uri.fsPath)}：${result.duplicate ? '已在书架' : '成功'}`);
          } catch (e) { results.push(`${path.basename(uri.fsPath)}：${e instanceof Error ? e.message : String(e)}`); }
        }
      });
      if (epoch === this.epoch) { await this.management('library'); void vscode.window.showInformationMessage(results.join('；') || '导入已取消'); }
    } finally { this.importing = false; this.importCancellation = undefined; cancellation.dispose(); }
  }
  private async message(key: string, m: any) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'ready') { if (key === this.active) { this.renderReader(); if (this.screen === 'library' || this.screen === 'statistics' || this.screen === 'settings') await this.renderManagement(); } return; }
    if (m.type === 'hide') { if (key === this.active) await this.hide(); return; }
    if (key !== this.active || m.token !== this.token || this.screen === 'hidden') return;
    if (m.type === 'rendered') {
      this.rendered = { key, screen: this.screen }; this.tracker.setVisible(this.readingVisible());
      return;
    }
    if (m.type === 'saveSettings' && this.screen === 'settings') {
      try {
        await this.updatePreferences(m.values);
        if (m.resume && this.book) await this.openBook(this.book.id);
        else this.send('library', { type: 'settingsSaved', token: this.token });
      } catch (e) { this.send('library', { type: 'settingsError', token: this.token, message: e instanceof Error ? e.message : '设置保存失败' }); }
      return;
    }
    if (m.type === 'action') {
      const allowed: Record<string, () => unknown> = { import: () => this.screen === 'library' ? this.importBooks() : undefined, library: () => this.management('library'), statistics: () => this.management('statistics'), resume: () => this.book && this.screen !== 'reader' ? this.openBook(this.book.id) : this.resume(), mode: () => this.modePicker(), settings: () => this.management('settings') };
      if (allowed[m.action]) await allowed[m.action](); else if (['previousPage', 'nextPage', 'previousChapter', 'nextChapter', 'toc'].includes(m.action)) await this.navigate(m.action);
    } else if (this.screen === 'reader' && this.content && m.bookId === this.book?.id) {
      if (m.type === 'activity') this.tracker.activity();
      if (m.type === 'pagePosition' && Number.isFinite(m.absolute)) this.schedulePosition(positionAt(this.content, m.absolute, m.atEnd === true));
      if (m.type === 'jump' && typeof m.position?.sectionId === 'string') this.jump(m.position);
      if (m.type === 'chapterEdge' && (m.direction === 1 || m.direction === -1) && this.position) {
        const current = chapterAt(this.content, this.position), target = chapters(this.content)[current.index + m.direction];
        if (target) this.jump(positionAt(this.content, m.direction === 1 ? target.start : target.end - 1));
      }
    } else if (['library', 'statistics'].includes(this.screen) && isId(m.id)) {
      if (m.type === 'open') await this.openBook(m.id);
      if (m.type === 'rename') {
        const state = await this.storage.read(); const book = state.books[m.id]; if (!book) return;
        const name = await this.input(token => vscode.window.showInputBox({ prompt: '修改显示书名', value: book.displayTitle, validateInput: v => v.trim() && v.trim().length <= 200 ? undefined : '请输入 1–200 个字符' }, token));
        if (name) { await this.storage.update(s => { if (s.books[m.id]) s.books[m.id].displayTitle = name.trim(); }); await this.renderManagement(); }
      }
      if (m.type === 'remove') {
        const state = await this.storage.read(); const book = state.books[m.id]; if (!book) return;
        const answer = await this.input(token => vscode.window.showQuickPick([{ label: '取消', confirm: false }, { label: '确认移除', description: book.displayTitle, detail: '删除插件副本、进度、记录及该书时长；原始文件保留。', confirm: true }], { title: `移除「${book.displayTitle}」？`, placeHolder: '请选择，或按 Esc 取消' }, token));
        if (answer?.confirm) { if (this.book?.id === m.id) { await this.endSession(); this.book = undefined; this.content = undefined; } await this.storage.remove(m.id); await this.renderManagement(); }
      }
    }
  }
  inspect() { return { screen: this.screen, active: this.active, mode: this.mode, bookId: this.book?.id, position: this.position, surfaces: [...this.surfaces.keys()], rendered: this.rendered }; }
  async shutdown() { await this.hide(); await this.storage.flush(); }
  dispose() { clearInterval(this.tickTimer); clearInterval(this.checkpointTimer); if (this.positionTimer) clearTimeout(this.positionTimer); this.report(this.shutdown()); }
}
