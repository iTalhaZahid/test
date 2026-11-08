import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build, Platform, Arch } from 'electron-builder';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const stage = path.join(desktop, '.test-dist/standalone-app');
const { backendConfig } = createRequire(import.meta.url)(path.join(desktop, 'dist/main/backend-config.js'));
let localEnvironment = {};
try { localEnvironment = parseEnv(await readFile(path.join(desktop, '../../.env.local'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const endpoint = backendConfig(process.env.POS_API_URL || localEnvironment.POS_API_URL, []);
if (!endpoint) throw new Error('Set POS_API_URL to the deployed POS backend origin in .env.local before packaging. Database credentials must not be bundled.');
const metadata = JSON.parse(await readFile(path.join(desktop, 'package.json'), 'utf8'));
await mkdir(stage, { recursive: true });
await writeFile(path.join(stage, 'pos-config.json'), JSON.stringify({ POS_API_URL: endpoint }));
await cp(path.join(desktop, 'dist'), path.join(stage, 'dist'), { recursive: true });
// Renderer dependencies are bundled by Vite; the main process uses Electron/Node only.
await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: 'pos-terminal-standalone', version: metadata.version,
  description: metadata.description, author: metadata.author,
  main: metadata.main, packageManager: 'npm@11.10.0',
}));
for (const file of ['electron-builder.yml', 'electron-builder.standalone.yml']) {
  await cp(path.join(desktop, file), path.join(stage, file));
}
await build({ projectDir: stage, targets: Platform.WINDOWS.createTarget('nsis', Arch.x64),
  publish: 'never', config: {
    extends: path.join(stage, 'electron-builder.standalone.yml'),
    electronVersion: metadata.devDependencies.electron,
    electronDist: path.join(desktop, 'node_modules/electron/dist'),
    directories: { output: path.join(desktop, 'release/standalone') },
    npmRebuild: false,
    files: ['dist/**/*', '!dist/main/**/*.test.js', 'pos-config.json'],
  },
});
