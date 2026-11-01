import type { WorkspaceLeaf } from 'obsidian'
import MindmapView from 'src/views/view'


export type MindmapTabLeaf = WorkspaceLeaf & { view: MindmapView }
export { MindmapView as MindmapTabView }
