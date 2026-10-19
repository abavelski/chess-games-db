export interface Source {
  id: number;
  source_key: string;
  title: string;
  author: string | null;
  original_file: string | null;
  game_count: number;
  kind: string;
}
export interface Catalog {
  capabilities?: { openings: boolean; criticalPositions?: boolean; studyMarkers?: boolean };
  path: string;
  sources: Source[];
  totals: { games: number };
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
  favourite: number;
  game_key: string;
  completeness: string;
  medal_count?: number | null;
  has_medals?: number | null;
  has_study_markers?: number | null;
  critical_position_count?: number | null;
  has_critical_positions?: number | null;
  opening?: OpeningInfo;
  id: number;
  source_id: number | null;
  source_game_key: string | null;
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
export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SearchFilters {
  favouritesOnly?: boolean;
  properties?: Partial<Record<PropertyKey, string[]>>;
  openingNodeId?: string;
  search?: string;
  yearFrom?: string;
  yearTo?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}
export interface ChessArchiveAPI {
  openDatabase(): Promise<{ canceled: boolean; catalog?: Catalog }>;
  propertyOptions(request: {property: PropertyKey; query?: string; filters?: SearchFilters; cursor?: string | number; limit?: number}): Promise<{options: PropertyOption[]; cursor: string | null}>;
  getCatalog(): Promise<Catalog | null>;
  searchGames(f: SearchFilters): Promise<Page<GameRow>>;
  openingFacets(f: SearchFilters): Promise<OpeningFacets>;
  setFavourite(id: number, favourite: boolean): Promise<boolean>;
  getGame(id: number): Promise<GameDetail | null>;

}
declare global {
  interface Window {
    chessArchive: ChessArchiveAPI;
  }
}

export type PropertyKey = 'source' | 'sourceSection' | 'sourceType' | 'players' | 'white' | 'black' | 'annotators' | 'event' | 'site' | 'year' | 'result' | 'completeness' | 'annotations' | 'medals' | 'criticalPositions' | 'studyMarkers' | 'eco';
export interface PropertyOption {id: string; label: string; count: number}
