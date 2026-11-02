import type { StudyTree } from './pgn.mjs';
export function annotation(tree:StudyTree,id:string):{text:string;nags:number[]};
export function setComment(tree:StudyTree,id:string,value:string):void;
export function setNags(tree:StudyTree,id:string,nags:number[]):void;
export interface StudyShape {brush:string;orig:import('@lichess-org/chessground/types').Key;dest?:import('@lichess-org/chessground/types').Key}
export function drawings(tree:StudyTree,id:string):StudyShape[];
export function setDrawings(tree:StudyTree,id:string,shapes:StudyShape[]):void;
