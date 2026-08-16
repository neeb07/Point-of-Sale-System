# Blaze POS

An offline-first point-of-sale system for restaurants, packaged as a Windows
desktop application. Everything — menu, orders, staff, inventory, reporting —
runs on the till itself. No internet connection is required to take a sale.

## Architecture

Three layers in one repository:

| Layer | Stack | Notes |
|---|---|---|
| `electron/` | Electron 42 | Spawns the backend as a child process, waits on `/api/health`, then loads the built frontend. |
| `backend/` | Express 5 + better-sqlite3 | REST API on port 3001. SQLite database in WAL mode. |
| `frontend/` | React 18 + Vite | Screen-switching shell (no router). Tailwind + Radix primitives. |

The database lives in Electron's `userData` directory in production
(`POS_USER_DATA_PATH`) and in `backend/` during development, so a reinstall
never destroys a shop's trading history.

## Prerequisites

- Node.js 18 or newer
- Windows build tools (only needed to compile `better-sqlite3` natively)

## Running locally

Install both halves:

```bash
cd backend  && npm install
cd ../frontend && npm install
```

Then run the whole stack — backend, Vite dev server and Electron together:

```bash
cd frontend
npm run electron:dev
```

To work on the frontend alone against a already-running backend:

```bash
cd frontend && npm run dev     # http://localhost:5173
cd backend  && npm run dev     # http://localhost:3001
```

Vite proxies `/api` to port 3001 in development. Note that application code
must always call the API through `src/api/index.ts`, which uses an absolute
base URL — bare `fetch('/api/...')` calls work in dev but break in the packaged
build, where the page is served over `file://`.

## Building the installer

```bash
cd frontend
npm run electron:build
```

Produces an NSIS installer via electron-builder. `prepare-backend` rebuilds
`better-sqlite3` against the Electron ABI before packaging.

## Default login

PIN `1234` (Admin / Owner). Change this in Settings → Cashier before going live.

## Backups

- A backup is written to `userData/backups/` on startup and every 24 hours.
- The seven most recent daily backups are kept; older ones are pruned.
- Settings → Data & Backup can export a copy or restore from one. A restore is
  verified and staged, then applied on the next launch — swapping the file
  underneath a live database connection would corrupt it.

## Project layout

```
backend/
  db/database.js      schema, migrations, seed data, auto-backup
  routes/             menu, orders, deals, staff, settings, reports,
                      inventory, shifts, whatsapp
  scripts/            one-off maintenance and test utilities
frontend/
  src/lib/theme.ts       all brand colours and shadows
  src/lib/constants.ts   deal groups, menu categories, payment methods
  src/api/index.ts       the only place that talks to the backend
  src/components/pos/    sale-screen components
  src/pages/             one file per screen
  electron/main.js       desktop process
```

## Configuration

`backend/routes/whatsapp.js` sends a daily sales report over the WhatsApp
Business API. It expects these environment variables:

```
WA_ACCESS_TOKEN      Meta access token
WA_PHONE_NUMBER_ID   sending number ID
WA_RECIPIENT_PHONE   owner's number, international format
```

Never commit these values.
