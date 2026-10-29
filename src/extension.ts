import * as vscode from 'vscode';
import { ReaderController } from './controller';
let controller: ReaderController | undefined;
export function activate(context: vscode.ExtensionContext) {
  const reader = controller = new ReaderController(context);
  context.subscriptions.push(reader,
    vscode.window.registerWebviewViewProvider('localReader.sidebar', reader.provider('sidebar')),
    vscode.window.registerWebviewViewProvider('localReader.libraryView', reader.provider('library')),
    vscode.window.registerWebviewViewProvider('localReader.panel', reader.provider('panel')));
  const commands: Record<string, () => unknown> = {
    import: () => reader.importBooks(), library: () => reader.management('library'), resume: () => reader.resume(),
    hide: () => reader.hide(), statistics: () => reader.management('statistics'), mode: () => reader.modePicker(),
    settings: () => reader.management('settings')
  };
  for (const action of ['previousPage', 'nextPage', 'previousChapter', 'nextChapter', 'toc']) commands[action] = () => reader.navigate(action);
  for (const [name, action] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(`localReader.${name}`, () => reader.run(action)));
  return reader;
}
export async function deactivate() { await controller?.shutdown(); }
