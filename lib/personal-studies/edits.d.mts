import type { StudyTree } from './pgn.mjs';
export function addMove(tree:StudyTree,id:string,input:string):string;
export function deleteMove(tree:StudyTree,id:string):string;
export function addContinuation(tree:StudyTree,id:string,moves:string[]):string;
