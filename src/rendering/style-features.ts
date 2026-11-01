import { globalSettings, settingChanges } from 'src/settings/filesystem'
import Callbag from 'src/utilities/callbag'


const { source: renderCodeblocks$, push: renderCodeblocks } = Callbag.subject<void>()
const { source: renderTabs$, push: renderTabs } = Callbag.subject<void>()
export { renderCodeblocks$, renderTabs$ }
const renderAll = () => { renderTabs(); renderCodeblocks() }

/**
 * Line thickness is a plain number per depth. The rules that use it live in
 * `styles.css`; only the values are written here, as CSS variables, so the
 * plugin never has to create a `<style>` element.
 */
function applyLineStyles() {
  document.body.setCssProps({
    '--advmm-line-thickness': String(globalSettings.defaultThickness),
    '--advmm-line-thickness-depth1': String(globalSettings.depth1Thickness),
    '--advmm-line-thickness-depth2': String(globalSettings.depth2Thickness),
    '--advmm-line-thickness-depth3': String(globalSettings.depth3Thickness),
  })
}

export function loadStyleFeatures() {
  applyLineStyles()
  for (const key of ['defaultThickness', 'depth1Thickness', 'depth2Thickness', 'depth3Thickness'] as const)
    settingChanges.listen(key, applyLineStyles)
}


// Color setting updates
settingChanges.listen('coloring', renderAll)
settingChanges.listen('defaultColor', renderAll)
settingChanges.listen('depth1Color', renderAll)
settingChanges.listen('depth2Color', renderAll)
settingChanges.listen('depth3Color', renderAll)
settingChanges.listen('colorFreezeLevel', renderAll)
//

settingChanges.listen('animationDuration', renderAll)
settingChanges.listen('initialExpandLevel', renderAll)
settingChanges.listen('maxWidth', renderAll)
settingChanges.listen('nodeMinHeight', renderAll)
settingChanges.listen('paddingX', renderAll)
settingChanges.listen('spacingHorizontal', renderAll)
settingChanges.listen('spacingVertical', renderAll)
settingChanges.listen('titleAsRootNode', renderTabs)
