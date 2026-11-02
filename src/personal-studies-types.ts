export interface StudyDraft {
 title: string; kind?: 'tournament' | 'other'; pgn?: string; tags?: string[];
 origin_kind?: 'blank' | 'pgn-file' | 'pgn-paste' | 'lichess-pgn'; origin_url?: string | null;
}
export interface Study extends Required<Omit<StudyDraft,'origin_url'>> {
 id: string; revision: number; origin_url: string | null; root_fen: string;
 white: string | null; black: string | null; white_elo: number | null; black_elo: number | null;
 event: string | null; site: string | null; date: string | null; round: string | null; result: string | null;
 eco: string | null; annotator: string | null; year: number | null; created_at: string; updated_at: string;
}
export interface StudyQuery {search?: string; kind?: string; year?: number; tags?: string[]; sort?: string; offset?: number; limit?: number}
export interface PersonalStudiesAPI {
 openPgn():Promise<{canceled:boolean;pgn?:string}>;
 onCloseRequest(callback:()=>void):()=>void;
 status(): Promise<{path: string; schemaVersion: number}>;
 list(request?: StudyQuery): Promise<{rows: Omit<Study,'pgn'>[]; total: number; offset: number; limit: number}>;
 get(request: {id: string}): Promise<Study>;
 create(draft: StudyDraft): Promise<Study>;
 update(request: {id: string; draft: StudyDraft; expectedRevision: number}): Promise<Study>;
 duplicate(request: {id: string}): Promise<Study>;
 delete(request: {id: string; expectedRevision: number}): Promise<boolean>;
}
declare global {interface Window {personalStudies: PersonalStudiesAPI}}
