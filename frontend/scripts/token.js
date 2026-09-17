/**
 * Where releases are published, and the key that lets this machine do it.
 *
 * Read from, in order:
 *   1. the environment: SUPABASE_URL and SUPABASE_SERVICE_KEY
 *   2. %USERPROFILE%\.blaze-release.json
 *   3. frontend/.release.json   (gitignored)
 *
 * The file is JSON with two fields:
 *   { "supabase_url": "https://<project>.supabase.co",
 *     "supabase_service_key": "<the service_role key>" }
 *
 * The service_role key can write to every bucket and table in the project, so
 * it lives only on the machine that builds releases, in that file, and never
 * in the repository. The tills need no key at all: the releases bucket is
 * public, read-only, and that is all a till ever does with it.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILES = [
  path.join(os.homedir(), '.blaze-release.json'),
  path.join(__dirname, '..', '.release.json'),
];

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

function findConfig() {
  const env = {
    supabase_url: (process.env.SUPABASE_URL || '').trim(),
    supabase_service_key: (process.env.SUPABASE_SERVICE_KEY || '').trim(),
  };
  if (env.supabase_url && env.supabase_service_key) return env;
  for (const f of FILES) {
    const j = readJson(f);
    if (j && j.supabase_url && j.supabase_service_key) {
      return { supabase_url: String(j.supabase_url).replace(/\/+$/, ''), supabase_service_key: String(j.supabase_service_key) };
    }
  }
  return null;
}

module.exports = { findConfig, FILES };
