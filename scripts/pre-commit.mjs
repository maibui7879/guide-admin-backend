import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const api = fileURLToPath(new URL('../apps/api/', import.meta.url));
const checks = [
  [root, ['node_modules/lint-staged/bin/lint-staged.js']],
  [api, ['node_modules/eslint/bin/eslint.js', 'src', 'test']],
  [api, ['node_modules/jest/bin/jest.js', '--runInBand', '--testPathPatterns=unit']],
];

for (const [cwd, args] of checks) {
  const result = spawnSync(process.execPath, args, { cwd, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
