import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';

/**
 * A quiet strip saying a newer version is on its way, or waiting.
 *
 * Deliberately not a dialog. An update is not something the person on the
 * till needs to decide about mid-service; it installs by itself the next time
 * the app closes. This exists so nobody is surprised by the installer at the
 * end of the day, and so somebody with a quiet moment can choose to take it
 * now — through the same guard as closing, so a drawer that is open refuses
 * it with the usual explanation.
 *
 * Renders nothing outside Electron, and nothing until there is something to
 * say.
 */

type Update = { version: string; downloaded: boolean } | null;

export default function UpdateNotice() {
  const [update, setUpdate] = useState<Update>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const api = (window as any).blazePOS;
    if (!api?.onUpdateReady) return;
    // Picks up an update that downloaded before this screen mounted, e.g.
    // after a sign-out and back in.
    api.updateStatus?.().then((s: any) => {
      if (s?.downloaded) setUpdate({ version: s.downloaded.version, downloaded: true });
      else if (s?.available) setUpdate({ version: s.available.version, downloaded: false });
    }).catch(() => {});
    return api.onUpdateReady((payload: Update) => { setUpdate(payload); setHidden(false); });
  }, []);

  if (!update || hidden) return null;

  const install = async () => {
    setBusy(true);
    try {
      const r = await (window as any).blazePOS.installUpdate();
      // Refused (a drawer is open): the close dialog has already explained.
      if (!r?.ok) setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      style={{
        position: 'fixed', left: 84, bottom: 16, zIndex: 40,
        display: 'flex', alignItems: 'center', gap: 12,
        background: '#111827', color: '#F9FAFB', borderRadius: 12,
        padding: '10px 14px', boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
        fontFamily: "'Inter', sans-serif", fontSize: 13,
      }}
    >
      {update.downloaded ? <RefreshCw size={16} /> : <Download size={16} />}
      <span>
        {update.downloaded
          ? <>Version <strong>{update.version}</strong> is ready. It installs the next time Blaze POS closes.</>
          : <>Downloading version <strong>{update.version}</strong> in the background.</>}
      </span>
      {update.downloaded && (
        <button
          onClick={install}
          disabled={busy}
          style={{
            height: 30, padding: '0 12px', borderRadius: 8, border: 'none',
            background: '#FFFFFF', color: '#111827', fontWeight: 700, fontSize: 12.5,
            cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {busy ? 'Restarting…' : 'Restart now'}
        </button>
      )}
      <button
        onClick={() => setHidden(true)}
        title="Hide"
        style={{ background: 'none', border: 'none', color: '#9CA3AF', cursor: 'pointer', padding: 2, display: 'flex' }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
