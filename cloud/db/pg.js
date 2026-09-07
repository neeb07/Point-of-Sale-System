/**
 * The cloud database — Supabase (Postgres).
 *
 * Replaces the earlier SQLite file. The trade is worth stating plainly, because
 * it shaped a lot of this codebase: SQLite let `backend/routes/reports.js` be
 * copied across untouched, and Postgres does not. Every `strftime`, `DATE()`
 * and `datetime('now','localtime')` had to be rewritten, and the danger there
 * is not a crash — it is a query that still runs and quietly returns different
 * numbers. See routes/reports.js, and the comparison test that guards it.
 *
 * What Supabase buys in return: managed backups, no disk to run out, no
 * question about network storage, and a console for looking at the data.
 *
 * Two things about `pg` that bite if unhandled, both dealt with here:
 *
 *   1. **Everything is async.** better-sqlite3 was synchronous, so every route
 *      that touched the database had to become async. There is no clever way
 *      around this and no attempt at one.
 *   2. **Numbers come back as strings.** `pg` returns `bigint` and `numeric` as
 *      text to avoid silent precision loss in JavaScript. A `SUM(total)` would
 *      arrive as "41250" and JSON-encode as a string, which the dashboard would
 *      render as `NaN` or concatenate. Every aggregate in this codebase is
 *      therefore cast in SQL — `COUNT(*)::int`, `SUM(x)::float8` — rather than
 *      parsed afterwards, so the shape is right at the source.
 */

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    'DATABASE_URL is not set. Point it at the Supabase connection string ' +
    '(Project Settings -> Database -> Connection string -> URI).'
  );
  process.exit(1);
}

/*
 * Supabase terminates TLS with its own certificate chain. `rejectUnauthorized:
 * false` is the connection Supabase itself documents for a pooled client; the
 * traffic is still encrypted, the certificate simply is not chain-verified.
 * Disabled entirely for a local Postgres, which has no TLS at all.
 */
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  // Small: this process is the only writer, and Supabase's free tier has a
  // modest connection ceiling that a generous pool would exhaust on its own.
  max: Number(process.env.PGPOOL_MAX) || 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

/*
 * A dropped connection must not take the process down.
 *
 * Supabase recycles idle connections, and an unhandled 'error' on an idle
 * client is a hard crash in Node. systemd would restart it, but the owner
 * would see the dashboard blink out for no visible reason.
 */
pool.on('error', (err) => {
  console.error('Idle Postgres client error (recovering):', err.message);
});

/*
 * Never leave a transaction open on a pooled connection.
 *
 * Supabase's pooler keeps the server-side connection alive after this process
 * goes away, so a crash or a `kill` partway through a transaction leaves it
 * `idle in transaction` — still holding its locks, indefinitely. The next
 * deploy then blocks on writes to the same tables for no visible reason. It
 * happened during development and took a while to recognise, because nothing
 * reports it: queries simply hang until the statement timeout.
 *
 * Thirty seconds is far longer than any transaction here, so a live one is
 * never at risk; an abandoned one is reaped instead of outliving the process
 * that opened it.
 */
pool.on('connect', (client) => {
  /*
   * `extra_float_digits = 3` asks Postgres for shortest-round-trip float text
   * rather than 15 significant digits. Without it an average came back as
   * 2819.94117647059 where the till had 2819.9411764705883 — the value is
   * being truncated on the way out, not computed differently. It rounds away
   * in any currency display, but a report is not the only consumer and a
   * figure that silently loses precision in transit is worth not shipping.
   */
  client
    .query("SET idle_in_transaction_session_timeout = '30s'; SET extra_float_digits = 3")
    .catch(err => console.error('Could not configure the connection:', err.message));
});

/**
 * Convert SQLite's `?` placeholders to Postgres's `$1, $2, …`.
 *
 * The reporting queries were written for SQLite and are maintained alongside
 * the till's copy in `backend/routes/reports.js`, which still uses `?`. Their
 * parameters are also assembled by helpers that append to the list — the branch
 * filter, the date range — so hand-numbering every placeholder would mean
 * renumbering whenever a clause moves, and an off-by-one there produces a query
 * that still runs against the wrong column rather than an error.
 *
 * Doing it mechanically keeps the two files diffable, which is what makes it
 * possible to notice when the till's reporting changes and this has not.
 *
 * Quoted strings are skipped so a literal `?` inside one is left alone.
 */
function toPg(sql) {
  let index = 0;
  let out = '';
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // A line comment runs to the end of the line. Skipping it is not cosmetic:
    // these queries are heavily commented, and an apostrophe in ordinary
    // English ("the till's own number") would otherwise be read as the start of
    // a string literal, swallowing every placeholder after it. The `?` then
    // reached Postgres unconverted, which reports a syntax error pointing at
    // the *next* token rather than the comment that caused it.
    if (ch === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment.
    if (ch === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // String or quoted identifier. A doubled quote inside is an escaped one.
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) { j += 2; continue; }  // '' escape
          j += 1;
          break;
        }
        j += 1;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    out += ch === '?' ? `$${++index}` : ch;
    i += 1;
  }
  return out;
}

/** Run a query, return its rows. Accepts `?` placeholders. */
async function q(sql, params = []) {
  const res = await pool.query(toPg(sql), params);
  return res.rows;
}

/** Run a query, return its first row or null. */
async function one(sql, params = []) {
  const rows = await q(sql, params);
  return rows.length ? rows[0] : null;
}

/** Run a statement, return how many rows it touched. */
async function run(sql, params = []) {
  const res = await pool.query(toPg(sql), params);
  return res.rowCount;
}

/**
 * Run several statements as one transaction.
 *
 * The callback is given a client; every statement must go through it rather
 * than through `q`, or it lands outside the transaction on a different
 * connection — which looks like it works right up until a rollback fails to
 * undo half the writes.
 */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* connection is gone */ }
    throw err;
  } finally {
    client.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, q, one, run, tx, close, toPg };
