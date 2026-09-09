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
};

function subscribe(channel, handler) {
  if (typeof handler !== 'function') return () => {};
  const wrapped = (_event, payload) => handler(payload);
  ipcRenderer.on(channel, wrapped);
  // Returned so React can clean up on unmount. Without it a remounted
  // component stacks a second listener and the dialog opens twice.
  return () => ipcRenderer.removeListener(channel, wrapped);
}

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
});
