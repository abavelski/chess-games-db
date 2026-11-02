import type { StudyTree } from './pgn.mjs';
export function annotation(tree:StudyTree,id:string):{text:string;nags:number[]};
export function setComment(tree:StudyTree,id:string,value:string):void;
export function setNags(tree:StudyTree,id:string,nags:number[]):void;
