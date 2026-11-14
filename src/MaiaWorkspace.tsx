import { useEffect, useState } from 'react';
import type { KindlePlayStatus } from './kindle-play-types';

export default function MaiaWorkspace({ active }: { active: boolean }) {
  const [status, setStatus] = useState<KindlePlayStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!active) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try { const value = await window.kindlePlay.status(); if (alive) setStatus(value); }
      catch { if (alive) setError('Could not read desktop listener status.'); }
      finally { if (alive) timer = setTimeout(() => void refresh(), 1000); }
    }
    void refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [active]);
  async function control(action: 'start' | 'stop') {
    setPending(true); setError('');
    try { setStatus(await window.kindlePlay[action]()); }
    catch { setError('Could not control the listener. Check desktop logs and retry.'); }
    finally { setPending(false); }
  }
  const transitioning = pending || status?.listener === 'starting' || status?.listener === 'stopping';
  return <main className="personal-studies-workspace" aria-label="Maia" data-active={active}>
    <h1>Maia</h1>
    {(error || status?.error) && <p role="alert">{error || status?.error}</p>}
    <p role="status">Listener: {status?.listener ?? 'Loading…'}{pending ? ' · Please wait…' : ''}</p>
    <div className="study-actions">
      <button disabled={!status || transitioning || status.listener === 'listening'} onClick={() => void control('start')}>Start listener</button>
      <button disabled={!status || transitioning || status.listener === 'stopped'} onClick={() => void control('stop')}>Stop listener</button>
    </div>
    {status && <>
      <p>Bind preference: {status.host}:{status.port}</p>
      {status.address && <p>Listening at {status.address.host.includes(':') ? `[${status.address.host}]` : status.address.host}:{status.address.port}</p>}
      <p>{status.securityNotice}</p>
      <p>Maia: {status.maia.available ? 'Available' : status.maia.configured ? 'Configured, unavailable' : 'Not configured'} · {status.maia.activity}</p>
      {status.game ? <section aria-label="Current game">
        <h2>Current game: {status.game.status}</h2>
        {status.listener !== 'listening' && <p>Session retained; listener is stopped.</p>}
        <p>Human: {status.game.playerColor} · Maia Elo: {status.game.rating} · Ply: {status.game.ply}</p>
        <p>Result: {status.game.result ? `${status.game.result.outcome} (${status.game.result.reason})` : 'In progress'}</p>
        <p>Last committed move: {status.game.lastMoveAt ? new Date(status.game.lastMoveAt).toLocaleString() : 'Never'}</p>
        <p>Committed turns are saved in My Studies.</p>
      </section> : <p>No current game. Start a game from the Kindle after starting the listener.</p>}
    </>}
  </main>;
}
