/**
 * Build, tag and publish a release with one command:  npm run release
 *
 * `npm run release:publish-only` skips the build and uploads what is already
 * in release/ — for when a build finished but the upload did not. Only the
 * files the release is missing are sent, each with its own retries.
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
const path = require('path');
const { spawnSync } = require('child_process');
const { findToken, FILES } = require('./token');

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

/**
 * Create the GitHub release before electron-builder starts.
 *
 * electron-builder runs one publisher per file, and when the release does
 * not exist yet each of them tries to create it — one wins, the other gets
 * "already_exists" and the build fails with half the files uploaded. Making
 * the release here first, once, means every publisher finds it.
 */
async function ensureRelease() {
  const pkg = require('../package.json');
  const { owner, repo } = pkg.build.publish[0];
  const tag = `v${pkg.version}`;
  const api = `https://api.github.com/repos/${owner}/${repo}/releases`;
  const headers = {
    Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    'User-Agent': 'blaze-release', 'Content-Type': 'application/json',
  };
  const existing = await fetch(`${api}/tags/${tag}`, { headers });
  if (existing.ok) { console.log(`Release ${tag} exists; adding files to it.`); return; }
  if (existing.status !== 404) throw new Error(`GitHub: ${existing.status} ${await existing.text()}`);
  const made = await fetch(api, {
    method: 'POST', headers,
    body: JSON.stringify({ tag_name: tag, name: tag, draft: false, prerelease: false }),
  });
  if (!made.ok) throw new Error(`Could not create release ${tag}: ${made.status} ${await made.text()}`);
  console.log(`Created release ${tag}.`);
}

run('node', [path.join(__dirname, 'tag-release.js'), ...(publishOnly ? ['--any-commit'] : [])]);
ensureRelease().then(() => {
  if (!publishOnly) {
    run('npm', ['run', 'prepare-backend']);
    run('npx', ['vite', 'build']);
    // Built here, uploaded by our own uploader: electron-builder's sends each
    // file once and gives up at the first dropped connection.
    run('npx', ['electron-builder', 'build', '--win', '--publish', 'never']);
  }
  run('node', [path.join(__dirname, 'upload-release.js')]);
}).catch((err) => { console.error(err.message); process.exit(1); });
