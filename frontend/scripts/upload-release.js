/**
 * Put a finished build where the tills look for updates: Supabase Storage.
 *
 * Why not GitHub Releases. From here, the route to GitHub's upload server ran
 * at about 60 KB/s and its endpoint gives up on an upload that slow before a
 * 100 MB installer is through — every attempt ended in a 500. Supabase's
 * region is seven times closer, and its uploads are resumable: the file goes
 * up in 6 MB pieces and a dropped connection continues from the last piece
 * rather than starting over.
 *
 * The bucket is public and read-only to the world, which is exactly what a
 * till needs: electron-updater reads latest.yml from it, then the installer.
 * Writing needs the project's service key, which lives only on the machine
 * that builds releases — see scripts/token.js.
 *
 *   node scripts/upload-release.js            (used by scripts/release.js)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tus = require('tus-js-client');
const { findConfig, FILES } = require('./token');

const pkg = require('../package.json');
const version = pkg.version;
const publish = pkg.build.publish[0];
const BUCKET = publish.url.split('/object/public/')[1].replace(/\/+$/, '');
const RELEASE_DIR = path.join(__dirname, '..', 'release');

const cfg = findConfig();
if (!cfg) {
  console.error('No Supabase key. Put this in ' + FILES[0] + ':');
  console.error('  { "supabase_url": "https://<project>.supabase.co", "supabase_service_key": "<service_role key>" }');
  console.error('(Supabase → Project Settings → API → service_role.)');
  process.exit(1);
}
if (!publish.url.startsWith(cfg.supabase_url)) {
  console.error(`package.json publishes to ${publish.url}, but the key is for ${cfg.supabase_url}.`);
  process.exit(1);
}
const auth = { Authorization: `Bearer ${cfg.supabase_service_key}`, apikey: cfg.supabase_service_key };

/** electron-builder's convention: spaces become dashes in the published name; latest.yml must agree. */
const assetName = (file) => path.basename(file).replace(/ /g, '-');
const sha512 = (file) => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';

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

/** The bucket, public, created on first use. */
async function ensureBucket() {
  const r = await fetch(`${cfg.supabase_url}/storage/v1/bucket/${BUCKET}`, { headers: auth });
  if (r.ok) {
    const b = await r.json();
    if (!b.public) {
      const u = await fetch(`${cfg.supabase_url}/storage/v1/bucket/${BUCKET}`, {
        method: 'PUT', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ public: true }),
      });
      if (!u.ok) throw new Error(`Could not make bucket "${BUCKET}" public: ${u.status} ${await u.text()}`);
    }
    return;
  }
  if (r.status !== 404 && r.status !== 400) throw new Error(`Supabase: ${r.status} ${await r.text()}`);
  const c = await fetch(`${cfg.supabase_url}/storage/v1/bucket`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (!c.ok) throw new Error(`Could not create bucket "${BUCKET}": ${c.status} ${await c.text()}`);
  console.log(`  created public bucket "${BUCKET}"`);
}

/** What the bucket already holds for this name, or null. */
async function existing(name) {
  const r = await fetch(`${publish.url}/${name}`, { method: 'HEAD' });
  if (!r.ok) return null;
  return { size: Number(r.headers.get('content-length')) || 0 };
}

/** Resumable upload: 6 MB pieces (Supabase's fixed size), retried and resumed on their own. */
function upload(file, name, { contentType, cacheControl }) {
  const size = fs.statSync(file).size;
  return new Promise((resolve, reject) => {
    let lastShown = -1;
    const u = new tus.Upload(fs.createReadStream(file), {
      endpoint: `${cfg.supabase_url}/storage/v1/upload/resumable`,
      headers: { ...auth, 'x-upsert': 'true' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024,
      uploadSize: size,
      retryDelays: [0, 3000, 8000, 15000, 30000, 60000, 60000, 60000, 60000, 60000],
      metadata: { bucketName: BUCKET, objectName: name, contentType, cacheControl: String(cacheControl) },
      onError: reject,
      onProgress: (sent) => {
        const pct = Math.floor((sent / size) * 100);
        if (pct !== lastShown && pct % 10 === 0) { process.stdout.write(`${pct}% `); lastShown = pct; }
      },
      onSuccess: () => resolve(),
    });
    u.start();
  });
}

(async () => {
  const installer = path.join(RELEASE_DIR, `Blaze-POS Setup ${version}.exe`);
  const blockmap = `${installer}.blockmap`;
  if (!fs.existsSync(installer)) { console.error(`No build for ${version}: ${installer}`); process.exit(1); }

  await ensureBucket();

  // The installer and its blockmap first; latest.yml last, so a till that
  // checks mid-upload still sees the previous complete release.
  const plan = [
    { file: installer, contentType: 'application/octet-stream', cacheControl: 31536000 },
    ...(fs.existsSync(blockmap) ? [{ file: blockmap, contentType: 'application/octet-stream', cacheControl: 31536000 }] : []),
    // Short cache: this is the file that says a new version exists.
    { file: writeLatestYml(installer), contentType: 'text/yaml', cacheControl: 60, always: true },
  ];

  for (const step of plan) {
    const name = assetName(step.file);
    const size = fs.statSync(step.file).size;
    const have = await existing(name);
    if (have && have.size === size && !step.always) {
      console.log(`  ${name}: already there (${mb(size)}), skipped`);
      continue;
    }
    process.stdout.write(`  ${name} (${mb(size)}): `);
    await upload(step.file, name, step);
    const check = await existing(name);
    if (!check || check.size !== size) throw new Error(`${name} did not arrive intact (${check ? mb(check.size) : 'missing'})`);
    console.log('done');
  }
  console.log(`\nRelease ${version} is live: ${publish.url}/latest.yml`);
})().catch((err) => { console.error('\n' + (err && err.message ? err.message : err)); process.exit(1); });
