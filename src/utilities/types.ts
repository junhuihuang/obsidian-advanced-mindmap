import { WorkspaceLeaf } from 'obsidian'
import MindmapView from 'src/views/view'


export namespace MindmapTab {
  export interface Leaf extends WorkspaceLeaf { view: View }
  export const View = MindmapView 
  export interface View extends MindmapView {}
}
