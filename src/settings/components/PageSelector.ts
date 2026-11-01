import { ButtonComponent, Setting } from 'obsidian'
import { Component, div, fragment } from './various'
import { Resolve } from 'src/utilities/utilities'
import { strings } from 'src/translation'

type Level = 'global' | 'file' | 'codeBlock'
export const PageSelector = (initialPage: Level, pages: Record<Level, () => Component>) => (parent: Node) => {
  const selector = new Setting(createDiv())
  const pageContainer = div([], 'advmm-main')

  const buttons = Object.fromEntries(
    (['global', 'file', 'codeBlock'] as const)
    .map(level => [level,
      Resolve<ButtonComponent>(resolve => selector.addButton(resolve))
        .setButtonText(strings.settings.level[level])
        .onClick(() => showPage(level))
    ])
  ) as Record<Level, ButtonComponent>

  let activeButton: ButtonComponent
  
  function showPage(level: Level) {
    pageContainer.node.replaceChildren(pages[level]().node)

    activeButton?.buttonEl.removeClass('advmm-active')
    activeButton = buttons[level]
    activeButton.buttonEl.addClass('advmm-active')
  }

  showPage(initialPage)

  const component = fragment([
    div([Component(selector.settingEl)], 'advmm-level-selector'),
    pageContainer
  ])

  parent.appendChild(component.node)
}
