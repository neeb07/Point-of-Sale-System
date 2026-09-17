/**
 * The GitHub token for publishing, from wherever it was stored once:
 *   1. the GH_TOKEN environment variable
 *   2. %USERPROFILE%\.blaze-release-token   (one line, the token)
 *   3. frontend/.release-token              (gitignored)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

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

module.exports = { findToken, FILES };
