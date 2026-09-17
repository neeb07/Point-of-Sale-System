/**
 * Put a finished build on its GitHub release — patiently.
 *
 * electron-builder's own uploader sends each file once, in one request, and
 * gives up at the first dropped connection. From a shop's connection a 60 MB
 * installer can take a quarter of an hour and drop twice on the way, and every
 * retry re-packed the installer first. This uploads only what the release is
 * missing, retries each file on its own, and writes latest.yml — the file the
 * tills read — from the installer it actually uploaded.
 *
 *   node scripts/upload-release.js            (used by scripts/release.js)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { findToken } = require('./token');

const pkg = require('../package.json');
const { owner, repo } = pkg.build.publish[0];
const version = pkg.version;
const tag = `v${version}`;
const RELEASE_DIR = path.join(__dirname, '..', 'release');
const API = `https://api.github.com/repos/${owner}/${repo}`;
const ATTEMPTS = 8;

const token = findToken();
if (!token) { console.error('No GitHub token (see scripts/release.js).'); process.exit(1); }
const headers = {
  Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'blaze-release',
};

/** electron-builder publishes "Blaze-POS Setup 1.1.5.exe" as Blaze-POS-Setup-1.1.5.exe; latest.yml must agree. */
const assetName = (file) => path.basename(file).replace(/ /g, '-');
const sha512 = (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');

function writeLatestYml(installer) {
  const size = fs.statSync(installer).size;
  const hash = sha512(installer);
  const name = assetName(installer);
  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${hash}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${hash}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  const out = path.join(RELEASE_DIR, 'latest.yml');
  fs.writeFileSync(out, yml);
  return out;
}

async function gh(method, url, body) {
  const r = await fetch(url, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** One attempt with curl, which streams the file and reports stalls. */
function curlUpload(uploadUrl, file, name) {
  const url = `${uploadUrl.replace(/\{.*\}$/, '')}?name=${encodeURIComponent(name)}`;
  const r = spawnSync('curl', [
    '-sS', '-o', '-', '-w', '\n%{http_code}',
    '--speed-time', '90', '--speed-limit', '512',   // give up if under 512 B/s for 90 s
    '--connect-timeout', '30',
    '-X', 'POST',
    '-H', `Authorization: Bearer ${token}`,
    '-H', 'Content-Type: application/octet-stream',
    '--data-binary', `@${file}`,
    url,
  ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { ok: false, reason: r.error.message };
  const out = (r.stdout || '').trim();
  const code = Number(out.slice(out.lastIndexOf('\n') + 1));
  if (r.status !== 0) return { ok: false, reason: (r.stderr || '').trim() || `curl exit ${r.status}` };
  if (code === 201) return { ok: true };
  return { ok: false, reason: `HTTP ${code} ${out.slice(0, 160)}` };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const installer = path.join(RELEASE_DIR, `Blaze-POS Setup ${version}.exe`);
  const blockmap = `${installer}.blockmap`;
  if (!fs.existsSync(installer)) { console.error(`No build for ${version}: ${installer}`); process.exit(1); }
  const files = [installer, ...(fs.existsSync(blockmap) ? [blockmap] : []), writeLatestYml(installer)];

  const release = await gh('GET', `${API}/releases/tags/${tag}`);
  const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

  for (const file of files) {
    const name = assetName(file);
    const size = fs.statSync(file).size;
    const fresh = await gh('GET', `${API}/releases/${release.id}/assets?per_page=100`);
    const existing = (fresh || []).find(a => a.name === name);
    if (existing && existing.state === 'uploaded' && existing.size === size && name !== 'latest.yml') {
      console.log(`  ${name}: already on the release (${mb(size)}), skipped`);
      continue;
    }
    if (existing) {
      console.log(`  ${name}: removing the ${existing.state === 'uploaded' ? 'old' : 'half-uploaded'} copy first`);
      await gh('DELETE', `${API}/releases/assets/${existing.id}`);
    }
    let done = false;
    for (let attempt = 1; attempt <= ATTEMPTS && !done; attempt++) {
      process.stdout.write(`  ${name} (${mb(size)}): uploading, attempt ${attempt} of ${ATTEMPTS}... `);
      const r = curlUpload(release.upload_url, file, name);
      if (r.ok) { console.log('done'); done = true; break; }
      console.log('failed: ' + r.reason);
      // A failed attempt can leave a broken asset behind that blocks the name.
      const again = await gh('GET', `${API}/releases/${release.id}/assets?per_page=100`);
      const stub = (again || []).find(a => a.name === name);
      if (stub) await gh('DELETE', `${API}/releases/assets/${stub.id}`);
      await sleep(Math.min(60, 5 * attempt) * 1000);
    }
    if (!done) { console.error(`Gave up on ${name} after ${ATTEMPTS} attempts. Run "npm run release:publish-only" to try again.`); process.exit(1); }
  }
  console.log(`\nRelease ${tag} is complete: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
})().catch((err) => { console.error(err.message); process.exit(1); });
