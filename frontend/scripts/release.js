/**
 * Build, tag and publish a release with one command:  npm run release
 *
 * `npm run release:publish-only` skips the build and publishes what is
 * already in release/win-unpacked — for when a build finished but the upload
 * did not (a dropped connection, a missing token).
 *
 * The GitHub token is read from, in order:
 *   1. the GH_TOKEN environment variable
 *   2. %USERPROFILE%\.blaze-release-token   (one line, the token)
 *   3. frontend/.release-token              (gitignored)
 *
 * Store it once in either file and the token never has to be typed again,
 * in any terminal, whether or not the terminal was opened after a user
 * variable was set. Neither file is ever committed.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const FILES = [
  path.join(os.homedir(), '.blaze-release-token'),
  path.join(__dirname, '..', '.release-token'),
];

function findToken() {
  if (process.env.GH_TOKEN && process.env.GH_TOKEN.trim()) return process.env.GH_TOKEN.trim();
  for (const f of FILES) {
    try {
      const t = fs.readFileSync(f, 'utf8').trim();
      if (t) return t;
    } catch (e) { /* not there */ }
  }
  return null;
}

const token = findToken();
if (!token) {
  console.error('No GitHub token. Put it on one line in:');
  console.error('  ' + FILES[0]);
  console.error('or set GH_TOKEN. The token needs the "repo" scope (classic) or Contents: read/write.');
  process.exit(1);
}

const env = { ...process.env, GH_TOKEN: token };
const shell = process.platform === 'win32';
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env, shell });
  if (r.status !== 0) process.exit(r.status || 1);
};

const publishOnly = process.argv.includes('--publish-only');

run('node', [path.join(__dirname, 'tag-release.js'), ...(publishOnly ? ['--any-commit'] : [])]);
if (!publishOnly) {
  run('npm', ['run', 'prepare-backend']);
  run('npx', ['vite', 'build']);
  run('npx', ['electron-builder', 'build', '--win', '--publish', 'always']);
} else {
  run('npx', ['electron-builder', '--win', '--publish', 'always', '--prepackaged', 'release/win-unpacked']);
}
