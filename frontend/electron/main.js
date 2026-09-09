const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');

let mainWindow;
let backendProcess;
let logPath;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  console.log(msg);
  try {
    if (logPath) fs.appendFileSync(logPath, line);
  } catch(e) {}
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  function waitForBackend(retries = 40, interval = 500) {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const check = () => {
        http.get('http://localhost:3001/api/health', (res) => {
          if (res.statusCode === 200) {
            log('[Main] Backend ready');
            resolve();
          } else {
            retry();
          }
        }).on('error', retry);
      };
      const retry = () => {
        attempts++;
        if (attempts >= retries) reject(new Error('Backend did not start'));
        else setTimeout(check, interval);
      };
      check();
    });
  }

  function startBackend() {
    const isDev = !app.isPackaged;

    log('=== startBackend called ===');
    log('isPackaged: ' + app.isPackaged);
    log('execPath: ' + process.execPath);
    log('resourcesPath: ' + process.resourcesPath);
    log('appPath: ' + app.getAppPath());
    log('userData: ' + app.getPath('userData'));

    let backendPath;

    if (isDev) {
      backendPath = path.join(__dirname, '../../backend/server.js');
    } else {
      const candidates = [
        path.join(process.resourcesPath, 'backend', 'server.js'),
        path.join(path.dirname(process.execPath), 'resources', 'backend', 'server.js'),
        path.join(app.getAppPath(), '..', 'backend', 'server.js'),
      ];
      candidates.forEach(p => log('candidate: ' + p + ' | exists: ' + fs.existsSync(p)));
      backendPath = candidates.find(p => fs.existsSync(p));
    }

    if (!backendPath) {
      log('ERROR: server.js not found in any path');
      return;
    }

    log('Using: ' + backendPath);

    const backendDir = path.dirname(backendPath);
    const sqlitePath = path.join(backendDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    log('sqlite3.node exists: ' + fs.existsSync(sqlitePath));
    log('node_modules exists: ' + fs.existsSync(path.join(backendDir, 'node_modules')));

    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      POS_USER_DATA_PATH: app.getPath('userData'),
      PORT: '3001',
    };

    try {
      backendProcess = spawn(process.execPath, [backendPath], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        env,
        windowsHide: true,
      });

      backendProcess.stdout.on('data', d => log('[Backend] ' + d.toString().trim()));
      backendProcess.stderr.on('data', d => log('[Backend ERR] ' + d.toString().trim()));
      backendProcess.on('exit', (code, signal) => log('[Backend] exited code=' + code + ' signal=' + signal));
      backendProcess.on('error', (err) => log('[Backend] spawn error: ' + err.message));

      log('Backend spawned successfully');
    } catch(err) {
      log('SPAWN THREW: ' + err.message);
    }
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 1024,
      minHeight: 600,
      /*
       * The window and taskbar icon.
       *
       * Separate from the one electron-builder stamps into the .exe: that one
       * is the file's icon in Explorer and the Start menu, this one is what
       * Windows shows while the app is running. Both have to be set or the
       * shortcut looks right and the running app still shows Electron's
       * default.
       *
       * In development the file sits beside the source; in the packaged app it
       * is in resources. Missing either way is not fatal — Electron falls back
       * to its own icon rather than refusing to open a window.
       */
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'icon.ico')
        : path.join(__dirname, '..', 'build', 'icon.ico'),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        // The one channel main has to the UI. See electron/preload.js — with
        // context isolation on, the renderer has no other way to be told
        // anything, and the close refusal below needs to reach the screen.
        preload: path.join(__dirname, 'preload.js'),
        // SECURITY: this was `false`, which disables the same-origin policy for
        // the whole renderer. It was presumably switched off because the
        // packaged app is served from file:// and calls http://localhost:3001,
        // but that combination works with web security on: the backend answers
        // the opaque `null` origin explicitly (see backend/server.js), so
        // nothing here needs the browser's protections turned off.
        webSecurity: true,
      },
      title: 'Blaze POS',
      autoHideMenuBar: true,
      show: false,
    });

    if (!app.isPackaged) {
      mainWindow.loadURL('http://localhost:5173');
      mainWindow.webContents.openDevTools();
    } else {
      mainWindow.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
      // Devtools used to open here too ("keep until fully working"), so the
      // shipped till launched with an inspector window in front of staff and
      // customers. It can still be opened deliberately with the shortcut below
      // when a problem needs diagnosing on site.
    }

    // F12 toggles devtools on demand, in packaged builds as well. The window
    // has no menu bar, so without this there is no way back in on a till.
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      }
    });

    mainWindow.once('ready-to-show', () => mainWindow.show());

    /*
     * The guard has to live here, not only on `before-quit`.
     *
     * Pressing the window's X closes the window first and quits afterwards, so
     * by the time `before-quit` runs the window is already destroyed and there
     * is nothing left to show a dialog in — the refusal would be invisible and
     * the app would look frozen. Holding the `close` event keeps the window
     * alive long enough to say why.
     *
     * `before-quit` is kept as the backstop for quits that do not start with
     * this window. Both consult the same check.
     */
    mainWindow.on('close', (event) => {
      if (quitConfirmed || sessionEnding) return;
      event.preventDefault();
      mayQuit(mainWindow).then((proceed) => {
        if (!proceed) return;
        quitConfirmed = true;
        stopBackend();
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
      });
    });

    mainWindow.on('closed', () => { mainWindow = null; });
  }

  function stopBackend() {
    if (backendProcess) {
      backendProcess.kill('SIGTERM');
      backendProcess = null;
    }
  }

  app.whenReady().then(async () => {
    // Set up log path FIRST before anything else
    const userDataPath = app.getPath('userData');
    try {
      if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
      logPath = path.join(userDataPath, 'backend-debug.log');
      // Clear old log on each launch
      fs.writeFileSync(logPath, '');
    } catch(e) {
      console.error('Could not create log file:', e.message);
    }

    log('app.whenReady fired');

    startBackend();

    try {
      await waitForBackend();
      log('Backend confirmed ready');
    } catch (err) {
      log('Backend wait failed: ' + err.message);
    }

    createWindow();
  });

  /*
   * The POS does not close over an open drawer.
   *
   * Closing the app does not close the shift: it stays open, the cash is never
   * counted, and the variance surfaces the next morning in front of somebody
   * who was not there. This used to be a prompt with a "Close anyway" button,
   * which meant the one person who could still count the drawer was offered a
   * way not to. Now it is a refusal.
   *
   * A refusal has to be escapable, or a shop ends up with a machine it cannot
   * turn off. Three ways out, and each is deliberate:
   *
   *   - The backend is unreachable. Nothing can be closed through a POS that is
   *     not answering, and a dead backend must never leave the machine stuck.
   *   - Windows is shutting down or restarting. Refusing there does not save
   *     the drawer; it stalls the shutdown and gets the process killed anyway,
   *     which is worse because it skips the cleanup below.
   *   - Every open shift has been closed, which is the intended way out and is
   *     what the dialog points at.
   *
   * An administrator can close anybody's shift from the Shifts screen, so a
   * drawer left open by somebody who has gone home is never a dead end. That
   * route did not exist until this refusal made it necessary — see
   * backend/routes/shifts.js.
   */
  let quitConfirmed = false;
  let sessionEnding = false;

  /** Set when Windows is logging out or restarting. See below. */
  app.on('session-end', () => { sessionEnding = true; });

  async function openShifts() {
    try {
      const res = await fetch('http://127.0.0.1:3001/api/shifts/open-count', {
        signal: AbortSignal.timeout(2000),
      });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body.shifts) ? body.shifts : [];
    } catch (err) {
      // Backend already gone, or unreachable. Never hold the machine hostage
      // to a component that is not answering.
      return [];
    }
  }

  /**
   * Ask the screen to explain the refusal.
   *
   * The in-app dialog is preferred over a native message box: it is the same
   * design as the rest of the till, it can list who has a drawer open, and it
   * can put the person one press from the screen that fixes it. The native box
   * stays as the fallback for the case where the window is gone or the page
   * has not loaded, because a refusal nobody can see is indistinguishable from
   * the app being broken.
   */
  async function explainRefusal(win, shifts) {
    const payload = { shifts };
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) {
      try {
        if (win.isMinimized()) win.restore();
        win.focus();
        win.webContents.send('blaze:close-blocked', payload);
        return;
      } catch (err) {
        log('Could not reach the window: ' + err.message);
      }
    }

    const names = shifts.map(s => s.staff_name).filter(Boolean).join(', ');
    await dialog.showMessageBox(win || null, {
      type: 'warning',
      buttons: ['Go back'],
      defaultId: 0,
      title: 'Close the shift first',
      message: 'A shift is still open on this till.',
      detail:
        (names ? `Open by: ${names}.

` : '') +
        'Blaze POS will not close while a drawer is open, so the cash is ' +
        'counted while the person who took it is still here. Close the shift ' +
        'on the Shifts screen, then close the app.',
    });
  }

  async function mayQuit(win) {
    if (quitConfirmed || sessionEnding) return true;
    const shifts = await openShifts();
    if (!shifts.length) return true;
    await explainRefusal(win, shifts);
    return false;
  }

  app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (quitConfirmed || sessionEnding) { stopBackend(); return; }

    // Hold the quit while the check runs; `before-quit` cannot await.
    event.preventDefault();
    const win = BrowserWindow.getAllWindows()[0];
    mayQuit(win).then((proceed) => {
      if (!proceed) return;
      quitConfirmed = true;
      stopBackend();
      app.quit();
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}