import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  throw new Error('The packaged TallyStick launcher currently supports macOS only.');
}

const siteDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const applicationPath = path.join(siteDirectory, 'release', `TallyStick-darwin-${process.arch}`, 'TallyStick.app');
if (!existsSync(applicationPath)) {
  throw new Error(`Packaged TallyStick was not found at ${applicationPath}. Run npm run desktop:start to build it first.`);
}
const launch = spawnSync('open', [applicationPath], { stdio: 'inherit' });

if (launch.error) throw launch.error;
if (launch.status !== 0) {
  throw new Error(`Unable to launch packaged TallyStick at ${applicationPath}. Run npm run desktop:start to build it first.`);
}
