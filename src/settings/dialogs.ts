import { PluginSettingTab, Modal, Editor } from 'obsidian'
import autoBind from 'auto-bind'

import { globalSettings, GlobalSettings } from './filesystem'
import { PageSelector } from './components/PageSelector'
import { CodeBlockPage, FilePage, GlobalPage } from './components/pages'
import { plugin } from 'src/core/main'
import { CodeBlockSettings, FileSettings } from './filesystem'
import { CodeBlockDoc, FileDoc } from './components/explanations'
import { createSettingsProxy } from './proxy'


/**
 * The settings UI is a custom, paginated layout: a page selector, values that
 * are inherited per file, and a live preview of the result. That cannot be
 * expressed as a list of setting definitions, so `display()` stays in charge.
 *
 * `getSettingDefinitions()` returns an empty list on purpose: Obsidian renders
 * the declarative list *instead of* `display()` only when there is at least one
 * definition, and returning nothing is also the honest answer — these settings
 * have no declarative description to offer settings search.
 *
 * The renderer is installed as the `display` property in the constructor
 * rather than as a class method: `Display` is deprecated from 1.13 on, and a
 * class member would only say "this tab also has a declarative description",
 * which it does not.
 */
export class GlobalSettingsDialog extends PluginSettingTab {
  constructor() {
    super(plugin.app, plugin)

    this.containerEl.addClass('advmm-settings-tab')

    const appendContent =
      PageSelector('global', {
        global: GlobalPage,
        file: FileDoc,
        codeBlock: CodeBlockDoc
      })

    this.display = () => {
      this.containerEl.empty()
      appendContent(this.containerEl)
    }
  }

  public getSettingDefinitions() { return [] }
}

export class FileSettingsDialog extends Modal {
  constructor(editor: Editor) {
    super(plugin.app)
  
    const fileSettings = createSettingsProxy('file', editor)

    this.containerEl.classList.add('advmm-settings-modal')

    const appendContent =
      PageSelector('file', {
        global: GlobalPage,
        file: FilePage(fileSettings),
        codeBlock: CodeBlockDoc
      })

    this.onClose = () => this.contentEl.empty()
    this.onOpen = () => appendContent(this.contentEl)
  }
}

export class CodeBlockSettingsDialog extends Modal {
  constructor(fileSettings: Partial<FileSettings>, codeBlockSettings: Partial<CodeBlockSettings>) {
    super(plugin.app)
    autoBind(this)

    const inheritSettings = new Proxy({} as GlobalSettings, {
      // When I wrote this, FileSettings was a subset of GlobalSettings
      // not sure exactly what this is supposed to do
      get: (_, key: keyof GlobalSettings) => key in fileSettings ? (fileSettings as Record<keyof GlobalSettings, unknown>)[key] : globalSettings[key],
      set: () => false
    })

    this.containerEl.classList.add('advmm-settings-modal')

    const appendContent =
      PageSelector('codeBlock', {
        global: GlobalPage,
        file: FilePage(fileSettings),
        codeBlock: CodeBlockPage(inheritSettings, codeBlockSettings)
      })

    this.onClose = () => this.contentEl.empty()
    this.onOpen = () => appendContent(this.contentEl)
  }
}
