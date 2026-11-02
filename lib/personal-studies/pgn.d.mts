import type { Game, PgnNodeData, Node } from 'chessops/pgn';
import type { Position } from 'chessops/chess';
export interface StudyNode extends Node<PgnNodeData> {id:string;data?:PgnNodeData;children:StudyNode[]}
export interface StudyTree {game:Game<PgnNodeData>;source:string;changed:boolean}
export interface StudyPosition {node:StudyNode;path:string;parentId:string|null;pos:Position;fen:string}
export function parseStudy(source:string):StudyTree;
export function serializeStudy(tree:StudyTree):string;
export function positions(tree:StudyTree):StudyPosition[];
export function positionById(tree:StudyTree,id:string):StudyPosition;
export function identityAtPath(tree:StudyTree,path:string):string;
export function pathForIdentity(tree:StudyTree,id:string):string;
export function semanticStudy(tree:StudyTree):unknown;
