import { runTests } from '@vscode/test-electron';
import { resolve } from 'node:path';
import { mkdir, mkdtemp, readdir, access } from 'node:fs/promises';
await mkdir('.test-data', { recursive: true });
const profilePath = process.env.LOCAL_READER_PROFILE_PATH ? resolve(process.env.LOCAL_READER_PROFILE_PATH) : await mkdtemp(resolve('.test-data/profile-'));
const options = {
  extensionDevelopmentPath: resolve(process.env.LOCAL_READER_EXTENSION_PATH || '.'), extensionTestsPath: resolve('dist/host-test.js'),
  launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--log', 'trace', '--user-data-dir=' + profilePath, '--extensions-dir=' + resolve('.test-data/extensions')],
  extensionTestsEnv: { LOCAL_READER_PROFILE_PATH: profilePath }
};
if (process.env.LOCAL_READER_DEBUG_PORT) options.launchArgs.push('--remote-debugging-port=' + Number(process.env.LOCAL_READER_DEBUG_PORT));
if (process.env.VSCODE_EXECUTABLE_PATH) options.vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH;
else if (process.platform === 'win32') {
  const cached = (await readdir('.vscode-test').catch(() => [])).filter(n => /^vscode-\d+\.\d+\.\d+$/.test(n)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const dir of cached) {
    const executable = resolve('.vscode-test', dir, 'Code.exe');
    try { await access(executable); options.vscodeExecutablePath = executable; break; } catch {}
  }
}
await runTests(options);
