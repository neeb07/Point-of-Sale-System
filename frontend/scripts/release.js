/**
 * Build, tag and publish a release with one command:  npm run release
 *
 * Steps: tag v<version> on the current commit and push the tag (a version
 * number is never reused), build the installer, upload it to the releases
 * bucket the tills watch (scripts/upload-release.js).
 *
 * `npm run release:publish-only` skips the build and uploads what is already
 * in release/ — for when a build finished but the upload did not. Only the
 * files the bucket is missing are sent, and a dropped connection resumes.
 *
 * The key for the bucket is read from %USERPROFILE%\.blaze-release.json —
 * see scripts/token.js. Store it once; it is never typed again.
 */
const path = require('path');
const { spawnSync } = require('child_process');
const { findConfig, FILES } = require('./token');

if (!findConfig()) {
  console.error('No Supabase key. Put this in ' + FILES[0] + ':');
  console.error('  { "supabase_url": "https://<project>.supabase.co", "supabase_service_key": "<service_role key>" }');
  process.exit(1);
}

const publishOnly = process.argv.includes('--publish-only');
const shell = process.platform === 'win32';
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell });
  if (r.status !== 0) process.exit(r.status || 1);
};

run('node', [path.join(__dirname, 'tag-release.js'), ...(publishOnly ? ['--any-commit'] : [])]);
if (!publishOnly) {
  run('npm', ['run', 'prepare-backend']);
  run('npx', ['vite', 'build']);
  run('npx', ['electron-builder', 'build', '--win', '--publish', 'never']);
}
run('node', [path.join(__dirname, 'upload-release.js')]);
