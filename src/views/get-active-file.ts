import { getApp } from 'src/core/app'
import { TFile } from 'obsidian'

export function getActiveFile(): TFile | null {
  const af = getApp().workspace.getActiveFile()
  return af?.extension === 'md' ? af : null
}
