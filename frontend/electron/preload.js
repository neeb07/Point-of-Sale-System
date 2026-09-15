/**
 * The only bridge between the main process and the till's UI.
 *
 * The renderer runs with `contextIsolation: true` and `nodeIntegration: false`,
 * which is what stops a compromised page from reaching the filesystem — so it
 * has no `require` and no `ipcRenderer`. Anything main needs to tell it has to
 * be handed across deliberately, here, one named function at a time.
 *
 * Kept as narrow as it can be: two listeners and nothing that sends. The
 * renderer cannot ask this process to do anything, only be told when something
 * has happened. Widening it later means adding a named channel here rather than
 * exposing a general-purpose message pipe, which is the thing worth avoiding —
 * a general pipe is a permanent hole that every future feature widens a little.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Channels main is allowed to push. Anything not listed cannot be subscribed to. */
const CHANNELS = {
  /** Somebody tried to close the app while a drawer was still open. */
  closeBlocked: 'blaze:close-blocked',
  /** A newer version is available or downloaded. */
  updateReady: 'blaze:update-ready',
};

function subscribe(channel, handler) {
  if (typeof handler !== 'function') return () => {};
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  // Returned so React can clean up on unmount. Without it a remounted
  // component stacks a second listener and the dialog opens twice.
  return () => ipcRenderer.removeListener(channel, wrapped);
}

/**
 * Channels the renderer may call and wait on.
 *
 * Wider than the listeners above, and narrow on purpose: two named calls, both
 * about printing, neither able to name a file or run anything. Adding to this
 * means adding a name here rather than opening a general pipe.
 */
const INVOKE = {
  listPrinters: 'blaze:list-printers',
  printCopy: 'blaze:print-copy',
  printRaw: 'blaze:print-raw',
  installUpdate: 'blaze:install-update',
  updateStatus: 'blaze:update-status',
};

contextBridge.exposeInMainWorld('blazePOS', {
  /** True only inside the packaged or dev Electron shell, never in a browser. */
  isElectron: true,

  /**
   * Called when a close attempt was refused because a shift is open.
   *
   * The payload carries the open shifts — id, who opened them, when — so the
   * screen can name them rather than saying "a shift" and leaving somebody to
   * work out whose.
   */
  onCloseBlocked: (handler) => subscribe(CHANNELS.closeBlocked, handler),

  /** The printers Windows knows about, so Settings can offer a real list. */
  listPrinters: () => ipcRenderer.invoke(INVOKE.listPrinters),

  /**
   * Print what is on screen at an exact page size.
   *
   * This exists because `window.print()` cannot set the length of the paper.
   * The print dialog picks a size from the ones the driver advertises, and on a
   * roll printer that is a fixed length — so a 62mm receipt still feeds a full
   * page and the rest comes out blank. Electron can ask for an exact page
   * instead, in microns, which is the only way to make the roll stop where the
   * receipt ends.
   */
  printCopy: (options) => ipcRenderer.invoke(INVOKE.printCopy, options),

  /**
   * Print a receipt as ESC/POS, bypassing Windows page printing entirely.
   *
   * For thermal printers whose driver will not honour a custom page size and
   * feeds a fixed form's worth of blank paper instead. The receipt is sent as
   * text and cut commands; the printer feeds exactly what it prints.
   */
  printRaw: (options) => ipcRenderer.invoke(INVOKE.printRaw, options),

  /** Told when a newer version is available, and again when it has downloaded. */
  onUpdateReady: (handler) => subscribe(CHANNELS.updateReady, handler),
  /** Install the downloaded update now. Refused, with the usual dialog, while a drawer is open. */
  installUpdate: () => ipcRenderer.invoke(INVOKE.installUpdate),
  updateStatus: () => ipcRenderer.invoke(INVOKE.updateStatus),
});
