/**
 * Deliver ESC/POS bytes to a named Windows printer.
 *
 * Goes through the Windows spooler as a RAW job, so the bytes reach the port
 * untouched and the printer's installed driver stays exactly as it is. No
 * native module and nothing to install: the spooler call is thirty lines of
 * P/Invoke in rawprint.ps1, run through the PowerShell every Windows machine
 * has.
 *
 * Why not a USB library. The ones that talk to the printer directly (escpos-usb
 * and friends) need libusb, which on Windows means replacing the printer's
 * vendor driver with WinUSB using Zadig — after which nothing else on that PC
 * can print to it, including the software the shop is migrating from. A native
 * `printer` module would avoid that but has to be compiled against Electron's
 * ABI for every release, is unmaintained, and adds a second native dependency
 * to a project that already has one it has to be careful with.
 *
 * The bytes are written to a temporary file rather than piped, because
 * PowerShell's stdin is text and would mangle them. The file is removed
 * whether or not the job succeeds.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const SCRIPT = path.join(__dirname, 'rawprint.ps1');

/** A job that takes longer than this is stuck, not slow. */
const TIMEOUT_MS = 30 * 1000;

function sendRaw(printerName, bytes, { jobName = 'Blaze receipt' } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      return resolve({ ok: false, error: 'Direct printing is only implemented for Windows' });
    }
    if (!printerName) return resolve({ ok: false, error: 'No printer chosen' });
    if (!bytes || !bytes.length) return resolve({ ok: false, error: 'Nothing to print' });

    const tmp = path.join(os.tmpdir(), `blaze-receipt-${process.pid}-${Date.now()}.bin`);
    try {
      fs.writeFileSync(tmp, bytes);
    } catch (err) {
      return resolve({ ok: false, error: 'Could not stage the job: ' + err.message });
    }

    const args = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, '-Printer', printerName, '-File', tmp, '-JobName', jobName,
    ];

    execFile('powershell.exe', args, { timeout: TIMEOUT_MS, windowsHide: true }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmp); } catch (e) { /* already gone */ }
      if (err) {
        const reason = (stderr || '').trim() || err.message;
        return resolve({ ok: false, error: reason });
      }
      resolve({ ok: true, detail: (stdout || '').trim() });
    });
  });
}

module.exports = { sendRaw };
