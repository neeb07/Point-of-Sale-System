/**
 * Tag the commit being released, so GitHub will accept a published release.
 *
 * electron-builder creates the release as "published" (build.publish
 * releaseType), and GitHub refuses to publish a release whose tag does not
 * exist yet — a draft needs no tag, a published release does. So before
 * building, this creates `v<version>` from package.json on the current
 * commit and pushes it. Idempotent: an existing tag on this commit is fine,
 * an existing tag on a *different* commit is a mistake and stops the release.
 */
const { execSync } = require('child_process');
const { version } = require('../package.json');

const tag = `v${version}`;
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const head = sh('git rev-parse HEAD');
let existing = null;
try { existing = sh(`git rev-list -n 1 ${tag}`); } catch (e) { /* no such tag */ }

if (existing && existing !== head) {
  console.error(`${tag} already points at ${existing.slice(0, 7)}, not at HEAD ${head.slice(0, 7)}.`);
  console.error('Bump "version" in package.json — a version number is never reused.');
  process.exit(1);
}
if (!existing) {
  sh(`git tag ${tag}`);
  console.log(`Tagged ${head.slice(0, 7)} as ${tag}`);
}
sh(`git push origin ${tag}`);
console.log(`${tag} is on GitHub`);
