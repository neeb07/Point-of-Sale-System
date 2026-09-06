/**
 * Authenticate a till.
 *
 * `Authorization: Bearer <branch api key>`. The key identifies the branch, and
 * **the branch is taken from the key alone** — any `branch_id` in the request
 * body is ignored. A compromised E-18 key therefore cannot write CBR Town's
 * figures, which is the property that matters most here: the whole point of the
 * dashboard is that the owner can trust which shop a number came from.
 */

const db = require('../db/database');
const { hashKey, hashesMatch } = require('../db/keys');

const activeBranchesStmt = db.prepare(
  'SELECT id, name, api_key_hash FROM branches WHERE active = 1'
);

function readBearer(req) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function requireBranch(req, res, next) {
  const key = readBearer(req);
  if (!key) {
    return res.status(401).json({ error: 'Branch key required', code: 'NO_BRANCH_KEY' });
  }

  const presented = hashKey(key);

  // Scanning every branch rather than looking the hash up directly, so that a
  // valid key and an invalid one do the same amount of work. There are two
  // branches; this costs nothing.
  let matched = null;
  for (const branch of activeBranchesStmt.all()) {
    if (hashesMatch(presented, branch.api_key_hash)) matched = branch;
  }

  if (!matched) {
    // Deliberately vague, and deliberately never echoes the key back — every
    // line this process logs ends up in a file on disk.
    return res.status(401).json({ error: 'Unrecognised branch key', code: 'BAD_BRANCH_KEY' });
  }

  req.branch = { id: matched.id, name: matched.name };
  next();
}

module.exports = { requireBranch };
