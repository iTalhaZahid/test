import { spawnSync } from 'node:child_process';
import process from 'node:process';
import electron from 'electron';
const result = spawnSync(electron, ['--test', 'dist/main/auth-store.test.js', 'dist/main/management-store.test.js', 'dist/main/sales-store.test.js', 'dist/main/desktop-flow.test.js', 'dist/main/receipt-printer.test.js', 'dist/main/online-connection.test.js'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
