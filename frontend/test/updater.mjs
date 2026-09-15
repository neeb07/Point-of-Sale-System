/**
 * The updater in the two situations it can be started in.
 *
 *   cd frontend
 *   node test/updater.mjs
 *
 * No GitHub, no packaged app: electron and electron-updater are stubbed so the
 * decisions — never check in development, never install what has not
 * downloaded, tell the screen at the right moments — can be checked in a
 * second.
 */
import { createRequire } from 'module';
import Module from 'module';
const require = createRequire(import.meta.url);

let failures = 0;
const ok = (label, cond) => { if (!cond) failures += 1; console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label); };

const handlers = {};
let quitArgs = null;
let checks = 0;
const fakeUpdater = {
  on: (ev, fn) => { handlers[ev] = fn; },
  checkForUpdates: async () => { checks += 1; },
  quitAndInstall: (...a) => { quitArgs = a; },
};
const app = { isPackaged: false, getVersion: () => '1.1.0' };
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app };
  if (request === 'electron-updater') return { autoUpdater: fakeUpdater };
  return realLoad.call(this, request, ...rest);
};
const updater = require('../electron/updater.js');
const logs = [];
const log = (m) => logs.push(m);

console.log('=== IN DEVELOPMENT ===');
ok('does not start checking', updater.start({ notify: () => {}, log }) === null);
ok('and says so in the log', logs.some(l => /not packaged/.test(l)));
ok('installing is refused', updater.installNow() === false);

console.log();
console.log('=== PACKAGED ===');
app.isPackaged = true;
const told = [];
const timer = updater.start({ notify: (p) => told.push(p), log });
ok('starts a timer', timer !== null);
clearInterval(timer);
ok('downloads by itself', fakeUpdater.autoDownload === true);
ok('and installs when the app closes', fakeUpdater.autoInstallOnAppQuit === true);
ok('nothing to install before anything downloaded', updater.installNow() === false && quitArgs === null);

handlers['update-available']({ version: '1.2.0' });
ok('tells the screen a version is coming', told.length === 1 && told[0].version === '1.2.0' && told[0].downloaded === false);
ok('still refuses to install it', updater.installNow() === false);
ok('status reflects it', updater.status().available.version === '1.2.0' && updater.status().downloaded === null);

handlers['update-downloaded']({ version: '1.2.0' });
ok('tells the screen it is ready', told.length === 2 && told[1].downloaded === true);
ok('now installs on request', updater.installNow() === true);
ok('showing the installer and relaunching the POS', quitArgs && quitArgs[0] === false && quitArgs[1] === true);

handlers['error'](new Error('net::ERR_INTERNET_DISCONNECTED'));
ok('a failed check is logged, not thrown', logs.some(l => /ERR_INTERNET_DISCONNECTED/.test(l)) && updater.status().last_error);

console.log();
console.log(failures ? failures + ' FAILED' : 'all passed');
process.exit(failures ? 1 : 0);
