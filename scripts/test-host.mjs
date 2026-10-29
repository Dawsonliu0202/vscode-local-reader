import { runTests } from '@vscode/test-electron';
import { resolve } from 'node:path';
import { mkdir, readdir, access } from 'node:fs/promises';
await mkdir('.test-data', { recursive: true });
const options = {
  extensionDevelopmentPath: resolve(process.env.LOCAL_READER_EXTENSION_PATH || '.'), extensionTestsPath: resolve('dist/host-test.js'),
  launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--log', 'trace', '--user-data-dir=' + resolve('.test-data/profile'), '--extensions-dir=' + resolve('.test-data/extensions')],
  extensionTestsEnv: { LOCAL_READER_PROFILE_PATH: resolve('.test-data/profile') }
};
if (process.env.VSCODE_EXECUTABLE_PATH) options.vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
else if (process.platform === 'win32') {
  const cached = (await readdir('.vscode-test').catch(() => [])).filter(n => /^vscode-\d+\.\d+\.\d+$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const dir of cached) {
    const executable = resolve('.vscode-test', dir, 'Code.exe');
    try { await access(executable); options.vscodeExecutablePath = executable; break; } catch {}
  }
}
await runTests(options);
