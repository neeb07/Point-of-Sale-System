const { app, BrowserWindow } = require('electron');
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
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
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

  app.on('window-all-closed', () => {
    stopBackend();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => stopBackend());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}