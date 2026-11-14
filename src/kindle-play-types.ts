export interface KindlePlayStatus {
  listener: 'stopped' | 'starting' | 'listening' | 'stopping' | 'error';
  host: string;
  port: number;
  address: { host: string; port: number; family: string } | null;
  maia: { configured: boolean; available: boolean; activity: 'idle' | 'thinking' };
  game: {
    status: 'playing' | 'finished';
    result: { outcome: 'white_win' | 'black_win' | 'draw'; reason: string } | null;
    rating: number;
    playerColor: 'white' | 'black';
    ply: number;
    lastMoveAt: string | null;
  } | null;
  error: string | null;
  securityNotice: string;
}

export interface KindlePlayAPI {
  status(): Promise<KindlePlayStatus>;
  start(): Promise<KindlePlayStatus>;
  stop(): Promise<KindlePlayStatus>;
}

declare global { interface Window { kindlePlay: KindlePlayAPI } }
