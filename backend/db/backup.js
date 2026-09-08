/**
 * Taking a backup of this till's database.
 *
 * This replaces a `fs.copyFileSync` of the database file, which was quietly
 * wrong and had been for as long as it had been running.
 *
 * The database runs in WAL mode. In WAL mode, recent writes live in a separate
 * `-wal` file and are only folded into the main file at a checkpoint, so
 * copying the main file alone captures the database as it was at some earlier
 * moment — with no error, and a file that opens perfectly and simply has less
 * in it. On the machine this was found on, every daily backup was missing the
 * last day of trading, and two of them were missing two days. The backups
 * looked healthy: same schema, same tables, plausible size.
 *
 * `VACUUM INTO` is the fix. It is a first-class SQLite operation that writes a
 * complete, consistent snapshot of the database as of the moment it runs — WAL
 * content included — while other connections keep reading and writing. It also
 * writes the copy compacted, so backups are smaller than the live file rather
 * than carrying its free pages around.
 *
 * A backup is written to a temporary name and renamed into place, because a
 * process killed halfway through must not leave a half-written file sitting
 * where a good one used to be. Renaming within a directory is atomic.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');

const userDataDir = process.env.POS_USER_DATA_PATH || path.join(__dirname, '..');
const backupDir = path.join(userDataDir, 'backups');

/** A week of daily files. Anything older is noise on a shop PC's disk. */
const KEEP_DAILY = 7;

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Open a backup and check it is actually a database with our data in it.
 *
 * A backup that has never been opened is a guess. This is cheap — it opens the
 * file read-only and counts two tables — and it is the difference between
 * "a file exists" and "a file we could trade from tomorrow".
 */
function verify(file) {
  const Database = require('better-sqlite3');
  let handle = null;
  try {
    handle = new Database(file, { readonly: true, fileMustExist: true });
    const required = ['menu_items', 'orders', 'order_items', 'staff', 'settings', 'shifts'];
    const tables = handle.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all().map(r => r.name);
    const missing = required.filter(t => !tables.includes(t));
    if (missing.length) return { ok: false, error: `missing tables: ${missing.join(', ')}` };

    const orders = handle.prepare('SELECT COUNT(*) n, MAX(created_at) last FROM orders').get();
    const staff = handle.prepare('SELECT COUNT(*) n FROM staff').get();
    return {
      ok: true,
      orders: orders.n,
      last_order_at: orders.last || null,
      staff: staff.n,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (handle) { try { handle.close(); } catch (e) { /* already gone */ } }
  }
}

/**
 * Take one.
 *
 * The file is named for the day and rewritten each time, so the newest backup
 * on disk is at most one interval old rather than up to a day. Yesterday's
 * file is untouched — the point of keeping seven is to be able to go back past
 * a problem that was itself backed up.
 */
function takeBackup(reason = 'scheduled') {
  const day = localDate();
  const target = path.join(backupDir, `pos_backup_${day}.db`);
  const staging = path.join(backupDir, `.taking_${process.pid}_${Date.now()}.db`);

  try {
    // VACUUM INTO refuses to overwrite, which is why this goes to a fresh name
    // and is renamed afterwards. The path is a literal rather than a bound
    // parameter because SQLite does not accept a parameter here.
    db.prepare(`VACUUM INTO '${staging.replace(/'/g, "''")}'`).run();

    const checked = verify(staging);
    if (!checked.ok) {
      // Never let a bad copy replace a good one.
      fs.unlinkSync(staging);
      throw new Error(`the copy did not verify — ${checked.error}`);
    }

    fs.renameSync(staging, target);
    prune();

    const size = fs.statSync(target).size;
    return {
      ok: true, path: target, day, reason, size,
      sha256: sha256(target),
      orders: checked.orders,
      last_order_at: checked.last_order_at,
      taken_at: new Date().toISOString(),
    };
  } catch (err) {
    try { if (fs.existsSync(staging)) fs.unlinkSync(staging); } catch (e) { /* nothing to clean */ }
    console.error('Backup failed:', err.message);
    return { ok: false, error: err.message };
  }
}

function listBackups() {
  return fs.readdirSync(backupDir)
    .filter(f => /^pos_backup_\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .map((f) => {
      const p = path.join(backupDir, f);
      const s = fs.statSync(p);
      return { file: f, path: p, size: s.size, modified: s.mtime.toISOString() };
    });
}

/** Newest first — what a recovery would actually reach for. */
function latest() {
  const all = listBackups();
  return all.length ? all[all.length - 1] : null;
}

function prune() {
  const all = listBackups();
  all.slice(0, Math.max(0, all.length - KEEP_DAILY))
    .forEach(b => { try { fs.unlinkSync(b.path); } catch (e) { /* already gone */ } });

  // Staging files from a process that was killed mid-backup.
  fs.readdirSync(backupDir).filter(f => f.startsWith('.taking_')).forEach((f) => {
    const p = path.join(backupDir, f);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > 60 * 60 * 1000) fs.unlinkSync(p);
    } catch (e) { /* already gone */ }
  });
}

/**
 * Every six hours, and once at startup.
 *
 * Daily was too coarse: a machine that dies at closing time would lose the
 * whole day. This is the local copy, which protects against a bad restore or
 * somebody deleting the wrong thing — it does not protect against the disk
 * failing, because it is on that disk. See sync/backup-upload.js for the copy
 * that leaves the building.
 */
const INTERVAL_MS = 6 * 60 * 60 * 1000;

function start() {
  const first = takeBackup('startup');
  if (first.ok) {
    console.log(
      `Backup: ${path.basename(first.path)} — ${first.orders} orders, ` +
      `${(first.size / 1024).toFixed(0)} KB.`
    );
  }
  const timer = setInterval(() => takeBackup('scheduled'), INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/** For the status endpoint, so a stale backup is visible rather than assumed. */
function status() {
  const newest = latest();
  return {
    backup_dir: backupDir,
    backup_count: listBackups().length,
    last_backup_at: newest ? newest.modified : null,
    last_backup_size: newest ? newest.size : null,
    last_backup_age_ms: newest ? Date.now() - new Date(newest.modified).getTime() : null,
  };
}

module.exports = { takeBackup, listBackups, latest, verify, start, status, backupDir };
