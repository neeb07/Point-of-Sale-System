/**
 * Keeping the tills current without visiting them.
 *
 * Every change to the POS used to mean building an installer, carrying it to
 * each shop and installing it over the top. With this, a release is published
 * to GitHub once and every till fetches it on its own: it checks at startup
 * and every few hours, downloads in the background, and installs the next
 * time the app closes. Nobody at the shop does anything.
 *
 * Two decisions worth stating.
 *
 * **It never restarts the app by itself.** A till is in service most of the
 * time it is running, and a drawer is open. The update is applied when the
 * app closes — which the close guard already refuses while a shift is open —
 * so an update lands at the end of the day, after the drawer is counted, and
 * never mid-order. The screen says an update is waiting; whoever closes up
 * gets it.
 *
 * **Updates come from a public Supabase Storage bucket** (package.json
 * `build.publish`): latest.yml says what the newest version is, the installer
 * sits beside it. The tills need no key — the bucket is world-readable — and
 * releases go up from the build machine with scripts/release.js. GitHub was
 * tried first and abandoned: from here the route to its upload server was too
 * slow for its endpoint to accept a 100 MB installer.
 *
 * Only in the packaged app. In development there is nothing to update to.
 */

const { app } = require('electron');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  // Not installed — a dev checkout without `npm install`, say. Updates are a
  // convenience, not a dependency the till can refuse to start without.
  autoUpdater = null;
}

/** Four hours: a release published mid-morning reaches the shops by the afternoon. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const state = {
  available: null,   // { version } once a newer release is known
  downloaded: null,  // { version } once it is on disk, ready to install
  lastCheckAt: null,
  lastError: null,
};

/**
 * Start checking. `notify(payload)` is called with { version, downloaded }
 * whenever there is something to tell the screen; `log` is the main
 * process's logger.
 */
function start({ notify, log }) {
  if (!app.isPackaged || !autoUpdater) {
    log('Updater: not packaged, or electron-updater absent — not checking.');
    return null;
  }

  autoUpdater.autoDownload = true;
  // The whole point: install when the app closes, never while it is in use.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  autoUpdater.on('update-available', (info) => {
    state.available = { version: info.version };
    log(`Updater: version ${info.version} is available; downloading.`);
    notify({ version: info.version, downloaded: false });
  });
  autoUpdater.on('update-not-available', () => {
    state.available = null;
  });
  autoUpdater.on('update-downloaded', (info) => {
    state.downloaded = { version: info.version };
    log(`Updater: version ${info.version} downloaded; installs on next close.`);
    notify({ version: info.version, downloaded: true });
  });
  autoUpdater.on('error', (err) => {
    // Logged, never surfaced as a dialog: a till that cannot reach GitHub
    // tonight is a till that updates tomorrow, not a broken till.
    state.lastError = err && err.message;
    log('Updater: ' + (err && err.message));
  });

  const check = () => {
    state.lastCheckAt = Date.now();
    autoUpdater.checkForUpdates().catch((err) => {
      state.lastError = err && err.message;
      log('Updater check failed: ' + (err && err.message));
    });
  };

  // A little after launch, so the backend and the window come up first, then
  // on a timer that never holds the process open by itself.
  setTimeout(check, 15 * 1000);
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

/**
 * Apply a downloaded update now.
 *
 * Only ever called after the same check that guards closing the app has
 * passed — see main.js — so this cannot restart a till with a drawer open.
 */
function installNow() {
  if (!autoUpdater || !state.downloaded) return false;
  // isSilent=false, isForceRunAfter=true: the NSIS installer shows its
  // progress and relaunches the POS when it finishes.
  autoUpdater.quitAndInstall(false, true);
  return true;
}

function status() {
  return {
    packaged: app.isPackaged,
    version: app.getVersion(),
    available: state.available,
    downloaded: state.downloaded,
    last_check_at: state.lastCheckAt ? new Date(state.lastCheckAt).toISOString() : null,
    last_error: state.lastError,
  };
}

module.exports = { start, installNow, status };
