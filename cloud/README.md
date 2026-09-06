# Blaze cloud

The API behind the admin dashboard at `blaze.virtiqo.com`. It ingests each
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
npm start                 # http://127.0.0.1:4000
```

The database is created on first run at `data/blaze_cloud.db`
(override with `BLAZE_CLOUD_DATA`).

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

## Deploying on the Virtualmin server

The Node process listens on loopback only; Apache/nginx terminates TLS and
proxies to it. This process never faces the internet directly.

1. **Create the sub-server.** Virtualmin → *Create Virtual Server* →
   `blaze.virtiqo.com` as a sub-server of `virtiqo.com`. `virtiqo.com` itself is
   untouched.
2. **Deploy the code** somewhere outside the web root, e.g.
   `/home/virtiqo/apps/blaze-cloud`, then `npm ci --omit=dev`.
3. **Reverse proxy.** Virtualmin → *Web Configuration → Proxying* → proxy `/`
   to `http://127.0.0.1:4000`.
4. **systemd unit** so it survives reboots and crashes
   (`/etc/systemd/system/blaze-cloud.service`):

   ```ini
   [Unit]
   Description=Blaze cloud API
   After=network.target

   [Service]
   Type=simple
   User=virtiqo
   WorkingDirectory=/home/virtiqo/apps/blaze-cloud
   Environment=NODE_ENV=production
   Environment=PORT=4000
   Environment=BLAZE_CLOUD_DATA=/home/virtiqo/apps/blaze-cloud-data
   ExecStart=/usr/bin/node server.js
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

   `systemctl enable --now blaze-cloud`
5. **HTTPS.** Virtualmin → *Manage SSL Certificate → Let's Encrypt*. Free and
   self-renewing. Non-negotiable: this is the shop's whole trading history
   leaving the building.

### Two things to check on the server first

- **Free disk.** `node_modules` alone is ~150–300 MB, and the database grows for
  years. A 1 GiB quota is not enough.
- **The data directory must be on a local disk, not network storage.** SQLite's
  file locking is unreliable over NFS. Normally a non-issue on a VPS; worth one
  look before committing.

`NODE_ENV=production` matters: it is what makes the session cookie `Secure`.
Set it, or sessions travel unencrypted.

## Why SQLite

The same engine the tills run. `backend/routes/reports.js` is ~600 lines of
SQLite-specific SQL (`strftime`, `DATE()`, `datetime('now','localtime')`); on
another engine it would have to be rewritten and then kept correct in two
dialects forever, with every rewrite checked against the original — a silently
different `GROUP BY` produces plausible wrong numbers rather than an error.
Same engine, same schema, so that file is copied rather than ported.

At two branches with a single writer, SQLite in WAL mode is comfortably
over-specified.

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
db/database.js          schema; WAL; opens data/blaze_cloud.db
db/keys.js              branch key generation, hashing, constant-time compare
middleware/branch-auth.js   Bearer branch key -> req.branch
middleware/session.js       httpOnly cookie -> req.user; sessions on disk
routes/auth.js          owner login / logout / me, rate limited
routes/ping.js          till pairing check; returns branch identity and clock skew
routes/live.js          heartbeat ingest (branch key) + live read (session)
scripts/provision.js    create branches and the owner account
```
