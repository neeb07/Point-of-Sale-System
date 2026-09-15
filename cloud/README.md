# Blaze cloud

The API behind the admin dashboard at `blaze.virtiqosolutions.com`. It ingests each
branch's live status and sales, and serves both-branch reporting.

Two kinds of caller, with two entirely separate credentials:

| Caller | Credential | Direction |
|---|---|---|
| A till | per-branch API key (`Authorization: Bearer …`) | pushes only |
| The owner | httpOnly session cookie | reads only |

A till can never read another branch's data, and the branch is taken from the
key alone — a `branch_id` in a request body is ignored.

## Running locally

```
npm install
export DATABASE_URL="postgresql://postgres:...@db.<project>.supabase.co:5432/postgres"
npm start                 # http://127.0.0.1:4000
```

`DATABASE_URL` comes from Supabase: *Project Settings -> Database -> Connection
string -> URI*. The schema is created on first run and is idempotent, so a
deploy is just a restart.

The server refuses to start if it cannot reach the database. That is
deliberate: one that answered requests against an unreachable database would
report an empty shop, which reads exactly like a shop that sold nothing.

## Provisioning

Branch ids **must match the ids the tills use** — 1 for E-18, 2 for CBR Town,
as seeded in `backend/db/database.js`. A mismatch files one shop's takings
under the other, so the script makes you pass the id explicitly.

```
node scripts/provision.js branch 1 "E-18 Branch"
node scripts/provision.js branch 2 "CBR Town Branch"
node scripts/provision.js owner owner@blaze.com "a long password" "Blaze Owner"
node scripts/provision.js list
```

Each branch command prints a `cloud-sync.json` ready to drop into that till's
Electron userData folder, beside `pos_database.db`.

**The key is printed once.** Only its SHA-256 hash is stored, so it cannot be
recovered — `provision.js rekey <id>` issues a new one and invalidates the old
one immediately.

## Deploying on Railway

The cloud runs as one container at `https://blaze.virtiqosolutions.com`,
serving both the API and the dashboard. The `Dockerfile` at the repo root is
the whole deployment; Railway detects it.

Prove the image on a laptop first — the failure that matters (an unresolved
package in the dashboard build) shows up here in a minute rather than in a
Railway log:

```powershell
docker build -t blaze-cloud .
docker run --rm -p 4000:4000 --env-file cloud/.env blaze-cloud
# http://localhost:4000 — the dashboard renders, /api/health answers
```

Then, in Railway:

1. **New Project → Deploy from GitHub** → this repository, branch `main`.
2. **Variables** on the service:

   | Variable | Value | Why |
   |---|---|---|
   | `DATABASE_URL` | the Supabase *session pooler* URI, port 5432, `%` in the password written as `%25` | the direct host is IPv6-only and hangs rather than failing |
   | `NODE_ENV` | `production` | makes the session cookie `Secure`; without it sign-in will not stick over HTTPS |
   | `TZ` | `Asia/Karachi` | reports group by local calendar day |
   | `BLAZE_CLOUD_HOST` | `0.0.0.0` | already set in the Dockerfile; harmless to set again |

   `PORT` is injected by Railway. Leave `BLAZE_DASHBOARD_DIST` unset.

3. **Settings → Networking → Custom Domain** → `blaze.virtiqosolutions.com`.
   Railway shows a CNAME target; add it at the DNS host for
   `virtiqosolutions.com`. TLS is issued once the record resolves.
4. **Settings → Deploy → Healthcheck Path** → `/api/health`. Restart on failure.
5. Open `https://blaze.virtiqosolutions.com/api/health` — `{"status":"ok"}` —
   then the dashboard, then sign in.

### What the image contains, and why

Only `cloud/` and the built `dashboard/dist`. The till (`backend/`, the
Electron app) is installed on shop PCs and has no place on a server;
`.dockerignore` keeps it out, along with every `.env`, database and backup.

The dashboard is built in a first stage that installs `frontend`'s runtime
packages. That is not an accident of layout: the dashboard compiles its screens
out of `frontend/src`, whose imports resolve upward into `frontend/node_modules`,
which a clean checkout does not have. All of those packages are runtime
dependencies and everything heavy (Electron, electron-builder) is dev-only, so
`npm ci --omit=dev` there is a few dozen megabytes. Nothing from that stage's
`node_modules` reaches the final image, which is ~250 MB of which ~6 MB is the
cloud's own dependencies.

The process listens on loopback by default, which is right behind a reverse
proxy on the same box. In a container the proxy is Railway's edge on another
machine, so the Dockerfile sets `BLAZE_CLOUD_HOST=0.0.0.0`. `trust proxy` is
already `1` in `server.js`, so the login and pairing rate limiters see the
caller's address rather than the edge's.

### Handing over to the client

Everything so far was built against a database full of test data. Before the
client signs in for the first time:

```powershell
cd cloud
node scripts/handover.js                                   # shows counts, does nothing
node scripts/handover.js --confirm "blaze.virtiqosolutions.com"
node scripts/provision.js owner <client-email> "<password>" "<name>"
```

The script deletes the trading history, every staff account, every dashboard
login, the payroll, the uploaded backups and the pairing codes; keeps the menu,
deals, shop settings, the two branches and the ingredients mirror; rekeys both
branches so the laptops this was built on stop reporting as the client's
shops; and writes a full export of what it deleted beside itself before it
starts. It refuses without the exact `--confirm` phrase.

Then the client changes the password you gave them (Settings → *Your
password*) and pairs each till (Backups → *Set up a replacement machine* → a
code, typed into the till's Settings → Branch & Cloud).

**Inventory does not come down.** Stock and recipes are per-till and are pushed
up only; the mirror kept in Supabase never reaches a fresh till. Each shop PC
starts with an empty stock list and has to have ingredients entered on it.

## Supabase, and what it costs

Supabase is Postgres, and the tills are SQLite. That difference is the single
largest source of risk in this codebase.

`routes/reports.js` is ~600 lines translated from `backend/routes/reports.js`.
Every `strftime`, `DATE()` and `GROUP_CONCAT` had to change, and the danger is
not a crash: it is a query that still runs and quietly returns a different
number. Four traps, all of which bit during the port:

1. **`pg` returns `bigint` and `numeric` as strings**, to avoid silent precision
   loss. An uncast `COUNT(*)` arrives as `"32"` and reaches the dashboard as a
   string. Every aggregate is therefore cast in SQL.
2. **`x::date` returns a JS `Date`**, which JSON-encodes as a full ISO
   timestamp — so an evening sale on the 7th comes back as the 6th. Dates in
   SELECT lists are formatted with `to_char`, not cast.
3. **Postgres requires SELECT and GROUP BY to agree**; SQLite did not.
4. **Timestamps are stored as text.** The tills write local wall-clock time with
   no zone; `timestamptz` would make Postgres attach the *server's* zone, so the
   same sale would read differently depending on where the server ran.
5. **Postgres requires SELECT and GROUP BY to agree**, and matches expressions
   textually — so adding a cast to an aliased column silently invalidates every
   other column derived from it.
6. **Floats are truncated to 15 digits on the wire** unless `extra_float_digits`
   is raised. Set on every connection.

Also worth knowing operationally: Supabase's pooler keeps a server connection
alive after this process dies, so a crash mid-transaction leaves it *idle in
transaction*, holding locks indefinitely, and the next deploy blocks on writes
for no visible reason. `db/pg.js` sets `idle_in_transaction_session_timeout` on
every connection so those are reaped.

The guard against all of this is `test/verify-against-till.js`, which syncs a
till's history up and checks all eleven report endpoints against the till's own
output field by field:

```
cd backend
DATABASE_URL="postgresql://..." node scripts/run-script.js ../cloud/test/verify-against-till.js
```

Run it after **any** change to either reporting file.

**It TRUNCATEs the cloud database.** So do `test/menu-downlink.js`. Both refuse
to run against a database that holds orders or a menu unless you also set
`BLAZE_ALLOW_DESTRUCTIVE=1` — a README warning was not enough, as proved by
running the menu test against the live project and leaving every item retired.
`test/dashboard-endpoints.js` and `test/dashboard-renders.js` are read-only and
safe anywhere. It runs
through `backend/scripts/run-script.js` because the till half needs Electron's
Node, whose ABI matches better-sqlite3; the cloud half runs as a child process
on plain Node, exactly as the two run in production.

What Supabase buys in return: managed backups, no disk to run out of, no
question about network storage, and a console for looking at the data.

## The menu

The cloud owns the menu outright, and it is the only thing that travels *down*
to the tills. That works because there is exactly one writer: the owner edits on
the dashboard, and a paired till refuses local menu edits rather than accepting
one that would silently vanish at the next snapshot.

Import the shop's current menu once, so both sides start identical:

```
DATABASE_URL=... node scripts/import-menu.js
```

Thereafter every edit moves `menu_version`. Tills read that integer from their
heartbeat response — a few bytes they were already receiving — and download the
whole snapshot only when it moves. Whole snapshots, never diffs: a snapshot
either applies or it does not, and missing three is the same as missing one.

Verify the whole path with:

```
cd backend
DATABASE_URL=... DASH_EMAIL=... DASH_PASSWORD=...   node scripts/run-script.js ../cloud/test/menu-downlink.js
```

## The dashboard

The React app lives in `dashboard/`. In production this process serves its
build, so the UI and the API share one origin — which is what lets the session
cookie be a plain `SameSite=Lax` httpOnly cookie with no CORS to negotiate.

```
cd dashboard && npm install && npm run build    # then start the cloud
```

In development run them apart; Vite proxies `/api` across:

```
cd cloud     && npm start      # 127.0.0.1:4000
cd dashboard && npm run dev    # 127.0.0.1:5174
```

Override the build location with `BLAZE_DASHBOARD_DIST` if the two are deployed
separately. If no build is present the API still runs.

## Layout

```
db/pg.js                connection pool; `?` -> `$n` conversion; transactions
db/schema.js            the Postgres schema, applied idempotently on boot
db/keys.js              branch key generation, hashing, constant-time compare
middleware/branch-auth.js   Bearer branch key -> req.branch
middleware/session.js       httpOnly cookie -> req.user; sessions on disk
routes/auth.js          owner login / logout / me, rate limited
routes/ping.js          till pairing check; returns branch identity and clock skew
routes/live.js          heartbeat ingest (branch key) + live read (session)
routes/ingest.js        sales batches, idempotent on (branch_id, local_id)
routes/reports.js       ported from backend/routes/reports.js, near-verbatim
routes/branches.js      branch list, and how complete each branch's data is
scripts/provision.js    create branches and the owner account
```
