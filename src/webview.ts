import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
export function webviewHtml(webview: vscode.Webview, extension: vscode.Uri): string {
  const nonce = randomBytes(18).toString('base64');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extension, 'dist', 'webview.js'));
  const style = webview.asWebviewUri(vscode.Uri.joinPath(extension, 'dist', 'webview.css'));
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${webview.cspSource}; font-src ${webview.cspSource};"><link rel="stylesheet" href="${style}"><title>Workspace Notes</title></head><body><div id="app"><div class="placeholder">Ready</div></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}
