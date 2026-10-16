export type Tab = 'all' | 'game' | 'position' | 'line' | 'text' | 'training' | 'records';

export interface Source {
  id: number;
  source_key: string;
  title: string;
  author: string | null;
  original_file: string | null;
  game_count: number;
  training_count: number;
  record_count: number;
}
export interface Catalog {
  capabilities?: { openings: boolean };
  path: string;
  sources: Source[];
  books: Array<{
    id: string;
    title: string;
    author: string | null;
    source_ids: number[];
    sections: Array<{ id: number; label: string; source_key: string }>;
    game_count: number;
  }>;
  totals: {
    books: number;
    entries: number;
    games: number;
    positions: number;
    training: number;
    texts: number;
  };
}
export interface OpeningInfo {
  status: 'matched' | 'unmatched' | 'invalid' | 'unenriched';
  name: string | null;
  eco: string | null;
  nodeId: string | null;
  path: string[];
  matchedPly: number | null;
}
export interface OpeningNode {
  id: string; label: string; parentId: string | null; path: string[]; count: number;
}
export interface OpeningFacets {
  supported: boolean; revision: string | null; total: number; classified: number;
  unclassified: number; nodes: OpeningNode[];
}
export interface GameRow {
  opening?: OpeningInfo;
  id: number;
  source_id: number;
  source_game_key: string;
  source_title: string;
  source_author: string | null;
  white: string | null;
  black: string | null;
  event: string | null;
  site: string | null;
  date: string | null;
  year: number | null;
  result: string | null;
  eco: string | null;
  game_type: string | null;
  record_kind: 'game' | 'position' | 'line' | 'text';
  is_training: number;
  training_magnitude: number;
  is_deleted: number;
  start_fen: string | null;
  annotator: string | null;
}
export interface GameDetail extends GameRow {
  pgn: string;
  headers_json: string;
  extras_json: string | null;
  pgn_sha256: string;
  source_key: string;
  created_at: string;
  updated_at: string;
}
export interface RecordRow {
  id: number;
  source_id: number;
  source_title: string;
  source_record_key: string;
  record_type: 'game' | 'text';
  status: 'extracted' | 'failed';
  raw_moves_size: number | null;
  raw_annotations_size: number | null;
  created_at: string;
  updated_at: string;
}
export interface RecordDetail extends RecordRow {
  raw_moves_size: number;
  raw_annotations_size: number;
  raw_preview: string | null;
  metadata_json: string;
}
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SearchFilters {
  openingNodeId?: string;
  search?: string;
  sourceId?: number | null;
  sourceIds?: number[];
  kind?: string;
  training?: string;
  deleted?: string;
  yearFrom?: string;
  yearTo?: string;
  white?: string;
  black?: string;
  eco?: string;
  event?: string;
  annotator?: string;
  result?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
  recordType?: string;
  status?: string;
}
export interface ChessArchiveAPI {
  openDatabase(): Promise<{ canceled: boolean; catalog?: Catalog }>;
  bookContents(bookId: string): Promise<BookContents>;
  getCatalog(): Promise<Catalog | null>;
  searchGames(f: SearchFilters): Promise<Page<GameRow>>;
  openingFacets(f: SearchFilters): Promise<OpeningFacets>;
  getGame(id: number): Promise<GameDetail | null>;
  searchRecords(f: SearchFilters): Promise<Page<RecordRow>>;
  getRecord(id: number): Promise<RecordDetail | null>;
}
declare global {
  interface Window {
    chessArchive: ChessArchiveAPI;
  }
}

export type Book = Catalog['books'][number];
export interface BookEntry {
  record_id: number | null;
  source_id: number;
  record_key: string;
  status: 'extracted' | 'failed';
  game_id: number | null;
  record_kind: string;
  is_training: number;
  is_deleted: number;
  title: string;
  error: string | null;
  sequence: number;
}
export interface BookContents extends Book { entries: BookEntry[] }
