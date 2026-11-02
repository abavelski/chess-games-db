import { PgnParser } from 'chessops/pgn';
import { Chess } from 'chessops/chess';
import { parseSan } from 'chessops/san';
import { INITIAL_FEN } from 'chessops/fen';

export const MAX_PGN_BYTES = 2 * 1024 * 1024;
export function text(value, name, max, optional = false) {
 if(optional && (value === undefined || value === null)) return null;
 if(typeof value !== 'string' || value.length > max || (!optional && !value.trim()) || value.includes('\0')) throw Error(`Invalid ${name} (maximum ${max} characters).`);
 return value.trim();
}
export function object(value, keys) {
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!keys.includes(key))) throw Error('Invalid study request fields.');
 return value;
}
export function tags(value = []) {
 if(!Array.isArray(value) || value.length>64) throw Error('Invalid tags (maximum 64).');
 const unique=new Map();
 for(const raw of value){const label=text(raw,'tag',64).replace(/\s+/g,' ');const key=label.toLowerCase();if(!unique.has(key))unique.set(key,label);}
 return [...unique].map(([key,label])=>({key,label}));
}

// chessops intentionally skips invalid PGN tokens. Check the lexical envelope
// first so malformed input cannot silently lose tokens on save.
function lexicalCheck(source) {
 let rest=source.replace(/^\uFEFF/,'').trim(), moves=0, balance=0, ended=false, headerPhase=true;
 const headers=new Set();
 while(rest) {
  let m;
  if((m=/^\s+/.exec(rest))){}
  else if(rest[0]==='{') {const end=rest.indexOf('}');if(end<0||rest.slice(1,end).includes('{'))throw Error('Malformed PGN comment.');m=[rest.slice(0,end+1)];}
  else if((m=/^;[^\r\n]*/.exec(rest))){}
  else if((m=/^\[([A-Za-z][A-Za-z0-9_]*)\s+"((?:[^"\\\r\n]|\\["\\])*)"\s*\]/.exec(rest))) {if(!headerPhase||headers.has(m[1]))throw Error('Multiple games or duplicate PGN header.');headers.add(m[1]);}
  else if((m=/^(?:1\/2-1\/2|1-0|0-1|\*)/.exec(rest))) {if(balance||ended)throw Error('Invalid PGN result or multiple games.');ended=true;headerPhase=false;}
  else {
   if(ended)throw Error('Only one game may be imported.');
   headerPhase=false;
   if((m=/^\d+\.(?:\.\.)?/.exec(rest))){}
   else if((m=/^\$\d+/.exec(rest))) {if(Number(m[0].slice(1))>255)throw Error('NAG must be 0–255.');}
   else if((m=/^[!?]{1,2}/.exec(rest))){}
   else if(rest[0]==='('){balance++;if(balance>64)throw Error('PGN variation nesting exceeds 64.');m=['('];}
   else if(rest[0]===')'){if(--balance<0)throw Error('Unmatched PGN variation.');m=[')'];}
   else if((m=/^(?:O-O-O|O-O|0-0-0|0-0|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?/.exec(rest))){moves++;}
   else throw Error('Malformed PGN token near: '+rest.slice(0,24));
  }
  rest=rest.slice(m[0].length);
 }
 if(balance)throw Error('Unclosed PGN variation.');
 if(!ended)throw Error('PGN must end with a result (* for unfinished).');
 return moves;
}

export function validatePgn(pgn) {
 if(typeof pgn!=='string'||new TextEncoder().encode(pgn).length>MAX_PGN_BYTES)throw Error('PGN must be UTF-8 text up to 2 MiB.');
 const expected=lexicalCheck(pgn), games=[];
 new PgnParser((game,error)=>{if(error)throw Error('PGN complexity limit exceeded.');games.push(game);},undefined,2_000_000).parse(pgn);
 if(games.length!==1)throw Error('Import exactly one game (one Lichess chapter).');
 const game=games[0];
 if((game.headers.has('Variant')&&!['Standard','Chess'].includes(game.headers.get('Variant')))|| (game.headers.has('SetUp')&&game.headers.get('SetUp')!=='0') || (game.headers.has('FEN')&&game.headers.get('FEN')!==INITIAL_FEN))throw Error('Only standard chess from the initial position is supported; FEN setups and variants are unavailable.');
 for(const [key,value] of game.headers)text(value,`header ${key}`,1000,true);
 let count=0;const stack=[{node:game.moves,pos:Chess.default(),ply:0}];
 while(stack.length) {
  const {node,pos,ply}=stack.pop();
  for(const child of node.children){
   if(++count>10000||ply>=1024)throw Error('Study exceeds 10,000 moves or 1,024 plies per line.');
   const next=pos.clone(),move=parseSan(next,child.data.san);
   if(!move)throw Error(`Illegal study move: ${child.data.san} at ply ${ply+1}.`);
   next.play(move);stack.push({node:child,pos:next,ply:ply+1});
  }
 }
 if(expected!==count)throw Error('PGN contains unsupported or misplaced move tokens.');
 return game;
}

export function metadata(game) {
 const fields={white:'White',black:'Black',white_elo:'WhiteElo',black_elo:'BlackElo',event:'Event',site:'Site',date:'Date',round:'Round',result:'Result',eco:'ECO',annotator:'Annotator'},row={};
 for(const [field,key] of Object.entries(fields))row[field]=game.headers.get(key)??null;
 for(const key of ['white_elo','black_elo']){const v=row[key];if(v===null||v==='?'||v==='')row[key]=null;else if(!/^\d{1,4}$/.test(v))throw Error('Ratings must be 0–9999 or unknown.');else row[key]=Number(v);}
 row.year=null;
 if(/^\d{4}\.\d{2}\.\d{2}$/.test(row.date??'')) {const iso=row.date.replaceAll('.','-'),date=new Date(iso+'T00:00:00Z');if(!Number.isNaN(+date)&&date.toISOString().slice(0,10)===iso)row.year=Number(row.date.slice(0,4));}
 return row;
}
