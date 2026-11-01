import { openPinnedMindmap } from 'src/views/open-mindmap'
import { strings } from 'src/translation'
import Callbag from 'src/utilities/callbag'
import { newActiveMarkdownView$ } from './active-markdown-view'


Callbag.subscribe(newActiveMarkdownView$, view =>
  view.addAction('dot-network', strings.commands.pinned,
    () => openPinnedMindmap(view.file)))
