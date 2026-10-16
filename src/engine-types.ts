export type EngineName = 'stockfish' | 'maia';
export interface EngineSettings {
  stockfishPath: string; pythonPath: string; checkpointPath: string;
  device: 'auto' | 'cpu' | 'mps' | 'cuda'; threads: number; hash: number; budget: number;
  model?: string; stockfishAvailable?: boolean; maiaAvailable?: boolean;
}
export interface EngineLine { rank: number; depth: number; score: { type: 'cp' | 'mate'; value: number; winner?: 'white' | 'black'; bound?: string }; moves: string[] }
export interface Candidate { move: string; probability: number }
export interface EngineUpdate extends Partial<EngineLine> { id: string; engine: EngineName; status: 'loading' | 'analyzing' | 'complete' | 'error'; error?: string; candidates?: Candidate[]; device?: string }
export interface EngineRequest { id: string; engine: EngineName; initialFen: string; moves: string[]; turn: 'white' | 'black'; lines: number; rating: number }
export interface EngineState { status: string; lines: EngineLine[]; candidates: Candidate[]; error?: string; device?: string }
export interface AnalysisOptions { stockfish: boolean; maia: boolean; lines: number; rating: number; revision: number }
declare global {
  interface Window { chessEngine: {
    settings(): Promise<EngineSettings>;
    configure(settings: EngineSettings): Promise<EngineSettings>;
    pick(kind: 'stockfishPath' | 'pythonPath' | 'checkpointPath'): Promise<string | null>;
    analyze(request: EngineRequest): Promise<{ id: string }>;
    stop(engine: EngineName): Promise<void>;
    onUpdate(callback: (event: EngineUpdate) => void): () => void;
  } }
}
