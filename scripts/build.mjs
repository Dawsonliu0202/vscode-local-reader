import { build, context } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
await mkdir('dist', { recursive: true });
const jobs = [
  { entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'], sourcemap: true, metafile: true },
  { entryPoints: ['webview/main.ts'], outfile: 'dist/webview.js', bundle: true, platform: 'browser', target: 'es2022', sourcemap: true },
  { entryPoints: ['test/host.ts'], outfile: 'dist/host-test.js', bundle: true, platform: 'node', format: 'cjs', target: 'node20', external: ['vscode'] }
];
await copyFile('webview/style.css', 'dist/webview.css');
for (const job of jobs) {
  if (process.argv.includes('--watch')) await (await context(job)).watch();
  else {
    const result = await build(job);
    if (result.metafile) {
      const packages = new Map();
      for (const input of Object.keys(result.metafile.inputs).filter(p => p.includes('node_modules/'))) {
        let dir = dirname(resolve(input));
        while (dir !== dirname(dir)) {
          try {
            const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
            if (pkg.name) {
              const files = await readdir(dir); const license = files.find(n => /^licen[cs]e(?:\.(txt|md))?$/i.test(n));
              packages.set(`${pkg.name}@${pkg.version}`, license ? await readFile(join(dir, license), 'utf8') : `License: ${pkg.license ?? 'See upstream package'}`); break;
            }
          } catch {}
          dir = dirname(dir);
        }
      }
      await writeFile('THIRD_PARTY_NOTICES.txt', 'Runtime dependencies bundled with Local Reader\n\n' + [...packages].sort().map(([name, license]) => `${name}\n${'='.repeat(60)}\n${license}\n`).join('\n'));
    }
  }
}
console.log('Local Reader build complete');
