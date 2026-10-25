export interface OpeningCoverage {
  sourceItems: number; processedItems: number; searchableDocuments: number; quarantinedDocuments: number;
  unsupportedAnnotations: number; indexedNodes: number; sourceLines: number; articles: number; readableVersions: number;
  sourceScope: string; deletedRecords: number; partialAnnotationDocuments: number;
}
export interface OpeningCatalog {
  format: string; libraryUUID: string; revision: string; corpus: string;
  capabilities: Record<string, boolean>; coverage: OpeningCoverage;
}
export interface OpeningLibraryStatus { catalog: OpeningCatalog | null; path: string | null; error: string | null }
export interface OpeningFilters { roles?: Array<'main_games' | 'theory'>; articleKeys?: string[]; query?: string; annotationLanguages?: string[] }
export interface OpeningRoute { mode: 'prefix' | 'position'; rootFen: string; moves: string[]; filters: OpeningFilters }
export interface OpeningCounters { gameRecordCount: number; sourceLineCount: number; relatedArticleCount: number; endingLineCount: number }
export interface OpeningContinuation extends OpeningCounters { uci: string; san: string }
export interface OpeningExploration extends OpeningCounters {
  token: string; mode: OpeningRoute['mode']; rootFen: string; moves: string[]; sans: string[]; fen: string;
  continuations: OpeningContinuation[]; coverage: OpeningCoverage; libraryUUID: string; revision: string;
  exhausted: boolean; emptyLibrary: boolean; requestId: number;
}
export interface OpeningPage<T> { items: T[]; total: number; page: number; pageSize: number; kind?: string }
export interface OpeningGameCard {
  key: string; white: string | null; black: string | null; event: string | null; date: string | null; eco: string | null;
  annotator: string | null; role: string; source: string; annotationCoverage: string; treeHash: string;
  match: { sourcePath: string; ply: number }; matchCount: number; matches: Array<{ sourcePath: string; ply: number }>;
}
export interface OpeningArticleCard { key: string; title: string; source: string; evidence?: string[] }
export interface OpeningCommentCard {
  key: string; treeHash: string; sourcePath: string; sequence: number; placement: string; language: string | null;
  sourceLanguage: string | null; fallback: boolean; text: string; previewTruncated: boolean;
  white: string | null; black: string | null; annotator: string | null;
}
export interface ReadingBlock {
  type: string; text?: string; children?: ReadingBlock[]; anchor?: string; level?: number; ordered?: boolean; fen?: string;
}
export interface ArticleTarget {
  anchor: string; kind: string; status: string; documentKey: string | null; treeHash: string | null; articleKey: string | null;
  positionHint: string | null; evidence: { notice?: string | null; candidates?: Array<{ stableKey: string | null; documentId: number | null; white?: string | null; black?: string | null; treeHash?: string | null; source?: string | null }> };
}
export interface OpeningArticle {
  key: string; title: string; source: string; language: string | null; sourceLanguage: string | null; fallback: boolean; meaningful: boolean;
  availableLanguages: Array<{ language: string; sourceLanguage: string }>; blocks: ReadingBlock[]; targets: ArticleTarget[];
  examples: Array<{ key: string; white: string | null; black: string | null; treeHash: string; evidence: string[] }>;
  examplesPage: number; examplesTotal: number; notices: Array<{ code: string; detail: string }>;
}
export interface OpeningSourceNode {
  id: number; parentId: number | null; ordinal: number; sourcePath: string; sourceIndex: number; ply: number;
  uci: string | null; san: string | null; mainline: boolean; exactKey: string;
}
export interface OpeningAnnotation {
  nodeId: number | null; sequence: number; type: string; sourceLanguage: string | null; language: string | null;
  placement: string; payload: { text?: string; nags?: number[]; arrows?: Array<{ from: string; to: string; color: string }>;
    squares?: Array<{ square: string; color: string }>; [key: string]: unknown }; status: string; payloadHash: string;
}
export interface OpeningStudy {
  key: string; treeHash: string; white: string | null; black: string | null; event: string | null; date: string | null;
  result: string | null; eco: string | null; annotator: string | null; source: string; role: string; startFen: string;
  annotationCoverage: string; nodes: OpeningSourceNode[]; annotations: OpeningAnnotation[];
  matchPath: string; matchingPaths: string[]; notice: string | null;
}
export interface OpeningStudySelection {
  key: string; treeHash?: string; sourcePath?: string; expectedPositionKey?: string; token?: string; notice?: string;
}
export interface OpeningStudyAPI {
  settings(patch?: Partial<OpeningUserState>): Promise<OpeningUserState>;
  status(): Promise<OpeningLibraryStatus>;
  openLibrary(): Promise<{ canceled: boolean } & Partial<OpeningLibraryStatus>>;
  explore(request: OpeningRoute & { revision: string; requestId?: number }): Promise<OpeningExploration>;
  materials<T = OpeningGameCard | OpeningArticleCard | OpeningCommentCard>(request: { revision: string; token: string; kind: 'games' | 'articles' | 'comments'; page?: number; pageSize?: number; language?: string }): Promise<OpeningPage<T>>;
  articleCatalog(request: { revision: string; query?: string; page?: number; pageSize?: number }): Promise<OpeningPage<OpeningArticleCard>>;
  article(request: { revision: string; key: string; language?: string; examplesPage?: number }): Promise<OpeningArticle>;
  study(request: { revision: string; key: string; treeHash?: string; sourcePath?: string; expectedPositionKey?: string; token?: string }): Promise<OpeningStudy>;
}
export interface OpeningExplorerState {
  route: OpeningRoute; kind: 'articles' | 'games' | 'comments'; page: number; flipped: boolean;
  previous: { route: OpeningRoute; page: number; kind: 'articles' | 'games' | 'comments'; flipped: boolean } | null;
  articleView: 'related' | 'catalog' | 'reader'; articleReturnView?: 'related' | 'catalog'; readerKeys: Array<{ key: string; id: number }>;
  articleNames: Record<string, string>; scrolls?: Record<string, number>;
}
export interface OpeningUserState {
  language?: string; workspace?: 'games' | 'openings'; session?: {
    libraryUUID: string; revision: string; corpus: string; explorer?: OpeningExplorerState;
    review?: { key: string; treeHash: string; sourcePath: string; flipped: boolean } | null;
  } | null;
}
declare global { interface Window { openingStudy: OpeningStudyAPI } }
