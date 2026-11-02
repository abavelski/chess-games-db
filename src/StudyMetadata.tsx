import { parsePgn, makePgn } from 'chessops/pgn';
import type { StudyDraft } from './personal-studies-types';

const headers=['White','Black','WhiteElo','BlackElo','Event','Site','Date','Round','Result','ECO','Annotator'];
export function StudyMetadata({draft,onChange,disabled=false}:{draft:StudyDraft;onChange:(draft:StudyDraft)=>void;disabled?:boolean}) {
 const game=parsePgn(draft.pgn??'*')[0];
 function header(key:string,value:string){game.headers.set(key,value);onChange({...draft,pgn:makePgn(game)});}
 return <fieldset disabled={disabled} className="study-metadata"><legend>Study details</legend>
  <label>Title<input aria-label="Study title" maxLength={200} value={draft.title} onChange={e=>onChange({...draft,title:e.target.value})}/></label>
  <label>Kind<select value={draft.kind??'other'} onChange={e=>onChange({...draft,kind:e.target.value as StudyDraft['kind']})}><option value="other">Other study</option><option value="tournament">Tournament game</option></select></label>
  <label>Tags (comma separated)<input aria-label="Study tags" value={(draft.tags??[]).join(',')} onChange={e=>onChange({...draft,tags:e.target.value.split(',')})}/></label>
  {headers.map(key=><label key={key}>{key}<input aria-label={`Study ${key}`} maxLength={1000} value={game?.headers.get(key)??''} onChange={e=>header(key,e.target.value)}/></label>)}
 </fieldset>;
}
