import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import type { ReaderController } from '../src/controller';
export async function run() {
  const manifest = JSON.parse(await readFile(path.join(__dirname, '..', 'package.json'), 'utf8')) as { publisher: string; name: string };
  const extension = vscode.extensions.getExtension<ReaderController>(`${manifest.publisher}.${manifest.name}`); assert.ok(extension);
  const extensionPath = extension.extensionPath;
  const titleActions = extension.packageJSON.contributes.menus['view/title'];
  assert.ok(titleActions.every((item: { when: string }) => item.when === 'view == localReader.libraryView'), 'reading panes must not duplicate the Webview toolbar actions');
  const reader = await extension.activate();
  assert.equal(reader.inspect().screen, 'hidden', 'activation must not automatically reveal text');
  assert.ok((await vscode.commands.getCommands(true)).includes('workbench.view.extension.local-reader-output'), 'bottom panel container must be registered');
  assert.ok((await vscode.commands.getCommands(true)).includes('workbench.view.extension.local-reader-library'), 'activity bar library container must be registered');
  assert.ok(vscode.workspace.getConfiguration('terminal.integrated').get<string[]>('commandsToSkipShell')?.includes('localReader.hide'));
  const temp = await mkdtemp(path.join(tmpdir(), 'local-reader-host-'));
  const originalPreferences = reader.preferences();
  async function rendered(key: string) { const deadline = Date.now() + 15000; while (reader.inspect().rendered?.key !== key) { if (Date.now() > deadline) throw new Error(`Webview ${key} did not render: ${JSON.stringify(reader.inspect())}`); await new Promise(r => setTimeout(r, 100)); } }
  async function captureStage(stage: string) {
    if (process.env.LOCAL_READER_LAYOUT_CAPTURE !== '1') return;
    const signal = path.join(extensionPath, '.test-data', `continue-${stage}`);
    await rm(signal, { force: true }); await writeFile(path.join(extensionPath, '.test-data', 'layout-stage.json'), JSON.stringify({ stage, state: reader.inspect() }));
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) { try { await access(signal); return; } catch {} await new Promise(r => setTimeout(r, 200)); }
    throw new Error(`Timed out capturing layout ${stage}`);
  }
  try {
    const file = path.join(temp, 'host.txt'); await writeFile(file, '第一章 开始\n' + '本地阅读集成测试正文。\n'.repeat(200) + '第二章 结束\n完结');
    await reader.storage.init(); const imported = await reader.storage.importFile(file);
    await vscode.commands.executeCommand('workbench.view.extension.local-reader-library'); await rendered('library');
    assert.equal(reader.inspect().screen, 'library', 'clicking the activity bar entry must open library management');
    await captureStage('library');
    const code = await vscode.workspace.openTextDocument({ content: 'const project = true;', language: 'javascript' }); await vscode.window.showTextDocument(code);
    const terminal = vscode.window.createTerminal({ name: 'reader-host-test' });
    await reader.openBook(imported.book.id, 'editor'); await rendered('editor'); assert.equal(reader.inspect().active, 'editor'); assert.equal(reader.inspect().screen, 'reader');
    await reader.switchMode('sidebar'); await rendered('sidebar'); assert.equal(reader.inspect().active, 'sidebar'); assert.ok(reader.inspect().surfaces.includes('sidebar'));
    await reader.switchMode('panel'); await rendered('panel'); assert.equal(reader.inspect().active, 'panel'); assert.ok(reader.inspect().surfaces.includes('panel'));
    assert.ok((await vscode.commands.getCommands(true)).includes('vscode.moveViews'));
    assert.ok(vscode.window.terminals.includes(terminal), 'native terminal must be reused');
    assert.ok(await terminal.processId, 'left pane must be backed by a real shell process');
    await reader.updatePreferences({ ...originalPreferences, panelReaderSide: 'right' });
    await reader.updatePreferences({ ...originalPreferences, panelReaderSide: 'left' });
    await reader.updatePreferences({ ...originalPreferences, panelReaderSide: 'right' });
    if (process.env.LOCAL_READER_PROFILE_PATH) {
      const logRoot = path.join(process.env.LOCAL_READER_PROFILE_PATH, 'logs');
      const latest = (await readdir(logRoot)).sort().at(-1)!;
      const viewLog = path.join(logRoot, latest, 'window1', 'views.log');
      const deadline = Date.now() + 8000; let moves = 0;
      while (Date.now() < deadline) {
        const text = await readFile(viewLog, 'utf8').catch(() => '');
        moves = (text.match(/Moved view terminal to localReader\.panel in terminal/g) ?? []).length;
        if (moves >= 2) break; await new Promise(r => setTimeout(r, 200));
      }
      assert.ok(moves >= 2, 'native view model must actually reorder the reader in both directions');
      console.log(`NATIVE LAYOUT PASS: view model recorded ${moves} reader/terminal moves`);
    }
    // Exercise the real extension-host message boundary without adding a test-only command.
    const host = reader as unknown as { token: string; message(key: string, message: unknown): Promise<void> };
    const beforeQuick = reader.preferences(), beforePosition = reader.inspect().position;
    const quickMessage = { type: 'saveReaderSettings', token: host.token, bookId: imported.book.id, requestId: 'host-quick', values: { fontSize: 24, lineHeight: 2.2, panelReaderSide: 'left' } };
    await host.message('sidebar', quickMessage);
    await host.message('panel', { ...quickMessage, token: 'stale-token' });
    await host.message('panel', { ...quickMessage, bookId: 'f'.repeat(64) });
    await host.message('panel', { ...quickMessage, values: { fontSize: 7, lineHeight: 2 } });
    assert.deepEqual(reader.preferences(), beforeQuick, 'inactive surface, stale token, wrong book and invalid values cannot save');
    await host.message('panel', quickMessage);
    assert.deepEqual(reader.preferences(), { fontSize: 24, lineHeight: 2.2, panelReaderSide: beforeQuick.panelReaderSide }, 'quick apply persists typography and preserves panel position');
    assert.deepEqual(reader.inspect().position, beforePosition, 'applying typography preserves the stable text position');
    await vscode.commands.executeCommand('localReader.settings'); await rendered('library');
    assert.equal(reader.inspect().screen, 'settings');
    await reader.updatePreferences({ fontSize: 18, lineHeight: 2, panelReaderSide: 'left' });
    assert.deepEqual(reader.preferences(), { fontSize: 18, lineHeight: 2, panelReaderSide: 'left' });
    await assert.rejects(reader.updatePreferences({ fontSize: -1, lineHeight: 2, panelReaderSide: 'left' }));
    await reader.openBook(imported.book.id, 'panel'); await rendered('panel');
    await captureStage('terminal');
    await reader.navigate('nextChapter');
    await reader.management('statistics'); await rendered('library'); assert.equal(reader.inspect().screen, 'statistics');
    await vscode.commands.executeCommand('localReader.hide'); assert.equal(reader.inspect().screen, 'hidden');
    await host.message('panel', quickMessage);
    assert.deepEqual(reader.preferences(), { fontSize: 18, lineHeight: 2, panelReaderSide: 'left' }, 'hidden surfaces cannot apply stale settings');
    const savedPosition = (await reader.storage.read()).books[imported.book.id].position;
    assert.ok(vscode.window.terminals.includes(terminal)); assert.ok(!code.isClosed);
    assert.ok(!vscode.window.tabGroups.all.flatMap(g => g.tabs).some(t => t.label === 'notes.log'));
    await vscode.commands.executeCommand('localReader.resume'); assert.equal(reader.inspect().screen, 'reader');
    assert.deepEqual(reader.inspect().position, savedPosition, 'resume must restore the saved text anchor');
    if (process.env.LOCAL_READER_UI_TEST === '1') {
      await reader.updatePreferences({ ...reader.preferences(), fontSize: 0, lineHeight: 1.8 });
      const marker = path.join(extension.extensionPath, '.test-data', 'keyboard-stage.json');
      async function stage(name: string) { await writeFile(marker, JSON.stringify({ stage: name, state: reader.inspect() })); }
      async function waitHidden() { const deadline = Date.now() + 180000; while (reader.inspect().screen !== 'hidden') { if (Date.now() > deadline) throw new Error('Timed out waiting for workbench hide shortcut'); await new Promise(r => setTimeout(r, 100)); } }
      await reader.openBook(imported.book.id, 'sidebar'); await rendered('sidebar'); terminal.show(); await stage('terminal-focus'); await waitHidden();
      await reader.openBook(imported.book.id, 'editor'); await rendered('editor'); await stage('webview-focus'); await waitHidden();
      await reader.openBook(imported.book.id, 'sidebar'); await rendered('sidebar'); await vscode.window.showTextDocument(code); await stage('editor-focus'); await waitHidden();
      await reader.openBook(imported.book.id, 'editor'); await rendered('editor'); const picker = reader.modePicker(); await stage('picker-focus'); await waitHidden(); await picker;
      await stage('passed'); console.log('WORKBENCH KEYBOARD PASS: terminal, webview, code editor, quick input cancellation');
    }
    await reader.hide(); await reader.storage.remove(imported.book.id); terminal.dispose();
    console.log('HOST TEST PASS: activity bar library, native terminal split, editor/sidebar/panel, management, panic hide, resume, terminal/editor isolation');
  } finally { await reader.updatePreferences(originalPreferences); await reader.shutdown(); await rm(temp, { recursive: true, force: true }); }
}
