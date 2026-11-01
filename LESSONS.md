# LESSONS.md

本文件记录开发过程中积累的经验教训，避免重复犯错，防止项目腐化。

---

## 1. 增量渲染 vs 全量渲染

### 教训
`markmap.setData()` 会调用 `_initializeData()` 重新计算所有节点的折叠状态，导致已有的折叠状态丢失、DOM 被全量重建。**任何编辑操作（增/删/改）都应走增量更新路径**，复用已有节点对象和 DOM。

### 正确做法
- 创建 `TreeUpdater` 模块（`src/rendering/tree-updater.ts`），在现有 `markmap.state.data` 树上做 reconcile
- `reconcile()` 重用已有 `INode` 对象（保留 D3 key、DOM、`payload.fold`），只更新变更的 content
- 调用 `markmap.renderData()`（不调用 `setData` / `_initializeData`）
- 每个编辑操作（insert、setText、remove）都必须生成 `TreeEdit` 记录传给 `treeUpdater`

### 错误模式
- 在 `removePaths` 里调用 `applyChange(next)` 但**不传 edits 参数** → `treeUpdater` 收不到删除信息 → 回退到 `setData` 全量渲染
- 试图用"保存折叠状态 → setData → 恢复折叠"的曲线救国方案（复杂度高且仍有闪烁）

---

## 2. shiftedPath 的路径位移逻辑

### 教训
当同时存在多个编辑操作时，每个 `TreeEdit` 的路径是**相对于该编辑发生时的树状态**（而非原始树）。`shiftedPath` 必须：
1. 同时处理 `insert`（索引+1）和 `remove`（索引-1）
2. 用**累积位移后的当前路径**（不是原始路径）做前缀和索引比较

### 错误模式
- `shiftedPath` 只处理 `insert` 不处理 `remove` → 删除操作导致路径匹配失败 → 回退到全量渲染
- 用 `original` 而非 `path`（累积位移后的值）做比较 → 多个连续编辑时路径偏差

### 示例
```ts
// insert: 同一同级位置及之后的节点索引 +1
if (edit.type === 'insert' && path[depth] >= edit.path[depth]) path[depth]++
// remove: 同一同级位置之后的节点索引 -1（不包括等于，等于是被删节点本身）
if (edit.type === 'remove' && path[depth] > edit.path[depth]) path[depth]--
```

---

## 3. 删除后光标聚焦规则

### 教训
删除节点后不应 `selectOnly(null)`（丢失焦点），应按以下优先级定位：
1. **被删位置的兄弟节点**（后一个节点顶上来的位置）
2. 如果没有后一个兄弟（删的是最后一个），聚焦**前一个兄弟**
3. 如果该层没有兄弟（删的是独生子），聚焦**父节点**
4. 以上都没有，才清除选中

### 错误模式
- `removePaths` 直接 `selectOnly(null)` → 用户需要重新点击选择，体验差

---

## 4. 测试中 setMarkdown 的处理

### 教训
- `applyChange` 内部 `await setMarkdown(next)`。如果测试的 `setMarkdown` 返回永不 resolve 的 Promise，所有后续断言都不会执行
- 测试需要模拟"写文件 + 重新渲染 DOM"的完整流程时，`setMarkdown` 应该 resolve 并更新 DOM（调用 `render()`）

### 正确模式
```ts
// 需要验证选择状态时 —— resolve 并重渲染
setMarkdown: async next => { md = next; render() }

// 只需验证 setMarkdown 被调用时 —— resolve 但不重渲染
setMarkdown: vi.fn((_markdown: string) => Promise.resolve())

// 验证"挂起但编辑器仍打开"时 —— 永不 resolve
setMarkdown: vi.fn((_markdown: string) => new Promise<void>(() => {}))
```

### 错误模式
- 验证选择状态时用不 resolve 的 `setMarkdown` → 测试永远挂起
- 验证选择状态时 resolve 但不重渲染 DOM → `domIndex()` 缓存不变，`advmmSourcePath` 与新路径不匹配

---

## 5. DOM 缓存失效

### 教训
`domIndex()` 缓存 DOM 扫描结果，只在节点断开连接（`isConnected === false`）时才刷新。测试中用 `svg.replaceChildren()` 重建 DOM 会自然触发缓存刷新，但如果 DOM 不重建，缓存永远指向旧节点。

### 正确做法
- 测试中 `setMarkdown` 配合 `render()` → `replaceChildren()` → 旧节点断开 → 缓存刷新
- 生产代码中，`renderData()` 的 D3 enter/exit 会自然处理 DOM 替换

---

## 6. 布局持久化

### 教训
保存/恢复分屏布局时，必须遍历**完整的 `app.workspace.rootSplit` 树**，不能只取一个 pane 的 `rootSplit.children[0]`。

### 正确做法
- 序列化格式使用版本号：`{ version: 1, root: Tree }`
- 恢复时兼容旧格式（数组格式），但不伪造缺失的 pane
- 每次修改后统一由 `layoutManager.renderVisible()` 递归渲染所有根/嵌套分屏

---

## 7. 批量编辑优化

### 教训
对 Markdown 做多次小编辑会导致多次解析/渲染。应合并为一次操作。

### 正确做法
- 批量删除：合并路径、过滤行，一次性生成结果
- 单次 DOM 扫描建立缓存（source tree、search、visible paths、DOM index）
- `latest-only` 渲染队列：快速连续编辑时跳过过时的中间状态

---

## 8. 生命周期清理

### 教训
renderer、editor、markmap 实例、SVG observer、异步任务必须在组件销毁时同步释放。否则会导致内存泄漏、残留事件监听、React/VDOM 冲突。

### 正确做法
- `destroy()` 中顺序清理：observer.disconnect() → removeEventListener → clearTimeout/Interval → 置空引用
- `TreeUpdater.update()` 忽略已销毁 renderer 的调用

---

## 9. 外部分析周期导致的覆盖

### 教训
Obsidian 的布局通知可能触发磁盘读取，在本地编辑尚未写入磁盘时覆盖内存中的文档。

### 正确做法
- 用 `lastWritten` 追踪最近写入的内容
- 收到外部文件变更时，如果与 `lastWritten` 匹配，跳过更新（知道自己刚写了这个）
- 如果不匹配，说明是真正的外部修改，走完整渲染路径

---

## 10. E2E 定时与异步渲染

### 教训
`markmap.renderData()` 使用 D3 transition 做动画。在 E2E 测试中读取 `payload.fold` 或 DOM 状态时，可能读到过渡中的中间值。

### 正确做法
- 折叠/展开操作后等待动画完成（`setTimeout(r, 500+)`）
- 或使用无动画的渲染选项进行测试
- 注意 Obsidian 窗口需要在焦点状态才能正常完成动画（Electron 后台窗口可能暂停动画）

---

## 11. 多应用场景的禁用

### 教训
在真机或模拟器中验证多应用场景中的行为（如 Split View / Slide Over）可能导致的状态不一致。

### 错误模式
- 没有真机或模拟器时就跳过这些场景的验证
- 未考虑窗口大小变化时的重新布局/缓存失效

---

## 12. 默认渲染配额

### 教训
断点中的递归可能需要硬限制以防止无限递归。

### 错误模式
- 向生产者发出错误的信号，导致错误的扩展级别
- 未能正确处理合成根（如"界面"节点仅渲染而不存在于源中）

---

## 13. Undo/Redo 后光标恢复

### 教训
Undo/Redo 后应该把光标定位到变更节点上，而不是清空选中。需要 diff 两个 markdown 快照来推断变更位置。

### 正确做法
- 通过节点计数判断操作类型：增加=`undo-delete`，减少=`undo-insert`，相等=`undo-rename`
- 节点增加时：优先找新路径+新文本的真正新节点，其次找文本变化，再其次找位移节点
- 节点减少时：并行遍历找出第一个文本不同的位置作为被删节点，聚焦其父节点或替换兄弟
- 始终兜底到 `afterFlat[0]`，绝不 `selectOnly(null)`

### 错误模式
- 直接把位移节点（路径变了但文本没变）当成新节点 → 聚焦错误的节点
- 用路径集合差集找被删节点不准确，因为后续节点位移会填补被删节点的路径
- `undo()` 调用前有挂起的 inline input 没有 commit → DOM 替换时 blur 触发 stale path 的 save

### 示例
删除 'b' 后 undo（`-a\n-c\n` → `-a\n-b\n-c\n`）：
- 节点数 2→3，走"增加"分支
- 路径 [1] 文本 'c'→'b'，差异 → 聚焦 [1]✓

Tab 创建子节点后 undo（`-a\n  -New node\n-b\n` → `-a\n-b\n`）：
- 节点数 3→2，走"减少"分支
- 并行遍历 i=1: 'New node' ≠ 'b' → removedIdx=1 → 被删路径 [0,0]
- parent=[0] → 聚焦 'a' ✓

---

## 14. 不要自己实现编辑器/预览，交给 Obsidian

### 教训（两次返工的结论）
"编辑 markdown 源码"这个需求我实现了两版都被推翻：
1. `Shift + hover` 浮层 textarea —— 交互不顺手，还要处理悬停宽限期；
2. 工具栏按钮 + 自绘 textarea 面板 —— 用户第一句话就是"**直接用 Obsidian 默认编辑器，不要单独实现**，而且没有 markdown preview"。

**结论：凡是"编辑/预览 markdown"的需求，一律不要自绘。** 用宿主已有的能力：
- 需要**编辑 + 预览** → 在分栏里打开同一个文件（`createLeafBySplit` + `openFile`），live preview / 源码 / 阅读视图全都白送，所有快捷键和插件也一致；
- 只需要**渲染** → `MarkdownRenderer.render()`；
- 不要在 body 上挂 `textarea` 去模拟编辑器。自绘编辑器的隐藏成本：焦点被抢、快捷键被吞、缩进、撤销、拼写检查、语法高亮、预览——每一项都要重做一遍且永远不如宿主。

### 环境事实（长期有效）
1. **焦点会被抢走**：`textarea.focus()` 只在"当前 leaf 激活"时成立；激活的是别的 leaf 时 Obsidian/CodeMirror 会立刻把焦点拿走（落到 `.cm-content` 或 `BUTTON.mod-cancel`）。**不要用 `blur` 做"关闭/保存"触发器**。
2. **快捷键会被吞掉**：Obsidian 在 `document` 的 capture 阶段处理全局快捷键，元素级监听收不到 `Tab`、`Ctrl+S`、`Ctrl+Enter`、`Ctrl+Z`（只有 `Escape`、`Enter`、`Shift+Enter` 能到达）。真需要时把监听挂在 **`window` 的 capture** 阶段（顺序 window → document → 元素），处理后 `preventDefault() + stopPropagation()`，并用 `event.target === input` 限定范围。
3. **`it('...')` 里的分栏**：`app.workspace.iterateAllLeaves()` 曾出现漏报（DOM 里有 `.workspace-leaf` 但回调没触发），**不要靠遍历 leaves 反查自己所在的 leaf**；`ItemView` 本来就有 `this.leaf`，从视图层传下来最可靠。
4. **`layout-change` 会在 `createLeafBySplit` 之后、`openFile` 完成之前就触发**，此时新 leaf 的 `containerEl` 还没进文档。若拿 `isConnected` 判断"是否被用户关掉"，会把正在打开的 leaf 误判为已关闭 → 每次点击都新开一个分栏。用 `opened` 标志区分"正在打开"和"已被关闭"。
5. **插件开关在 localStorage**：`localStorage.setItem("enable-plugin-" + app.appId, "true")`；只写 `.obsidian/community-plugins.json` 不够。
6. **md 解析器的 `$` 锚点不匹配带 `\r` 的行**（`.` 不匹配 `\r`），CRLF 文档会被整体跳过。

### 正确做法（最终形态）
- 入口放在**视图头部的 actions**（`ItemView.addAction()`，位于 Obsidian 自带 "More options" 按钮左侧，和 markdown 视图右上角一致）：`addAction(icon, title, callback)` 会**前插**（prepend），所以按最终顺序的**反序**添加；激活状态用 `.is-active` 类回显（`.clickable-icon.is-active` 是 Obsidian 自带样式）。
  - 不要用 `markmap-toolbar` 的浮层工具栏（`.mm-toolbar`）：它是独立浮层，样式/位置都和宿主不一致。需要 zoom 时直接调 `markmap.rescale()` / `markmap.fit()`。
  - `addAction()` 只接受 Obsidian（Lucide）图标名。要沿用旧工具栏的自绘图标，先 `addAction` 再替换按钮子节点：`<svg class="svg-icon" viewBox="0 0 20 20">` + 内联 `style="fill: currentColor; stroke: none"`。**必须用内联 style 覆盖** `.svg-icon` 的 `fill: none; stroke: currentColor`，否则填充图形会变成几乎不可见的描边；填充写 `currentColor` 才能让 `.is-active` 自动变主题色。
- 分栏由 `createLeafBySplit(this.leaf, 'vertical')` + `leaf.openFile(file, { active: true })` 创建；不传 `state`，让文件保持用户上次使用的模式。
- 关闭时 `leaf.detach()`，并监听 `layout-change` 同步按钮状态（用户手动关掉分栏时按钮不能一直亮着）。

### 调试经验
- E2E 用 CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` 复现真实交互；`Runtime.evaluate` 的合成事件不可靠。
- 点击前先确认 `document.elementFromPoint(x, y)` 命中的就是要点的元素——工具栏被别的 pane 盖住时坐标点击会静默失效（本次排障就因为这一点绕了很久）。
- 统计 pane 数量要用"可见"元素（`offsetParent`）或 `.workspace-leaf` 总数，`data-type` 计数会把后台标签页也算进去。
- `ws.close()` 别忘了，否则脚本挂住；`pkill` 后 Obsidian 需要十几秒才把 CDP 端口恢复。

---

## 15. 行内编辑框的尺寸必须由"文本"决定，不能由"节点当前的框"决定

### 症状
在新建节点或按 `i` 编辑短节点时，只要连续输入一段中文（10 个字左右），编辑框就变成"又窄又高"；一提交，节点又变回又宽又扁。

### 根因
旧实现是 `width = max(nodeRect.width, 120)`：宽度取的是**节点此刻的框宽**。编辑期间节点文本不会重排（提交后才 `setData`），所以框宽被冻结在旧文本的宽度上；新文本只能在这个窄框里折行 → 高度一路涨。提交后 markmap 按新文本重新排版 → 又变宽变扁。两次形状不一致。

### 正确做法
**框宽 = 提交后节点会得到的宽**，也就是 markmap 的排版规则：
- `textWidth = 单行文本宽度`（用隐藏的 `white-space: pre` 镜像元素测量，字体/字号/行高与编辑框完全一致 —— 不要用 `scrollWidth` 翻转 `wrap` 属性，那会让光标跳动）
- `width = clamp(ceil(textWidth) + 1, 极小下限, maxWidth)`
- `height = scrollHeight`（宽度确定后再量，得到真实折行高度）；**没输入过**时用节点自身高度作为下限（节点可能是 `nodeMinHeight` 或已折行），**输入过之后**只用文本高度，这样删字时框会跟着缩。

### maxWidth 从哪来
markmap 把实际用到的 `maxWidth` 写到 `<svg>` 的 `--markmap-max-width` 自定义属性上，样式表默认 `9999px`（等于"不折行"）。直接读这个值（`getComputedStyle(svg)`，再乘 `getScreenCTM` 的缩放），就自动跟随**全局设置、单文件 frontmatter、代码块参数**，不需要把 options 从渲染层一路接到编辑层。`>= 9000` 视为"无限制"。

### 验证方式（重要）
这类几何问题**单元测试证明不了**（jsdom 没有排版）。用真实浏览器量：
1. `vite` 起一个临时页面，`Markmap.create()` 渲染一棵小树（`duration: 0`、`autoFit: false`），导入 `src/editing/inline-input.ts` 的真实函数；
2. 通过 CDP 调 `openInlineInput` + `Input.insertText` 模拟输入；
3. 对比"编辑框宽高"与"用新文本重新 `setData` 后节点的宽高"。
实测（`maxWidth: 400`）：`短` 节点 16×20 → 编辑框 17×20；输入 10 个汉字 → 161×20（单行，不再折行）；提交后节点 160×20。长文本 → 编辑框 400×60，提交后节点 400×60。`zoom 2` 下 32×40 → 321×40 → 提交 320×40。

### 踩到的坑
- 提交前的 `height` 一定要先把 `height: auto` 再读 `scrollHeight`（`overflow: hidden` 时 `scrollHeight == clientHeight`，一次量大了就永久记住）。
- 编辑框漏掉 `overflow: hidden` 会预留滚动条宽度，导致刚好放得下的一行被折成两行（这次就是靠它误判了一次）。
- Electron/Obsidian 的 E2E 窗口如果没有合成器帧，`requestAnimationFrame` 不触发 → markmap 的 `renderData` 卡在 `await new Promise(requestAnimationFrame)`，所有节点 rect 都是 0×0，看起来像"点击没反应/选中失效"。用 `Page.startScreencast` 或 `Page.captureScreenshot` 喂帧，或者直接用普通 Chrome + 独立页面测几何。

## 16. 新建节点的行内编辑框不能靠"定时追踪"就位

### 症状
新建一个节点时，画面上出现两个 "New node"，而且**不重合**；回车后只剩一个。

### 根因
不是真的插入了两个节点。新建节点时输入框立刻打开（不等异步渲染/磁盘写入），这段时间它挂在**锚点节点**（新节点的父/前一个兄弟）上；等 markmap 渲染出新节点后，输入框本该"跳"到新节点上。旧实现只靠 `trackPosition()` 的定时循环（`animationDuration + 300ms`）在追位置，**追踪窗口一过就再也不更新**。真实场景里"写入队列 + 重新读文件 + 增量渲染"可能超过 800ms（大文件、慢设备、写入队列里还有别的改动），于是输入框永远停在锚点上，看起来就是两个 "New node" 相距很远。

### 正确做法（三条，缺一不可）
1. **事件驱动**：给 `openInlineInput` 传 `observe: svg`，编辑器打开期间用 `MutationObserver` 观察 mindmap 的 `childList`，任何节点增删/重渲染都重算位置；`finish()` 时 `disconnect()`。只观察 `childList`（`class`/`transform` 每帧都被 markmap 改写）。
2. **重新装弹**：光有事件驱动不够。markmap 的入场节点先画在父节点位置、再**动画滑**到自己的位置；渲染迟到时事件驱动只会在动画第 0 帧定位一次。所以 mutation 必须**重置追踪窗口**（`end = now + duration + 300` 并确保 rAF 循环在跑）。
3. **跟着"还在动"走，而不是跟着时长走**：窗口到期的判断不能只看时间。
   - 每一帧都比较 rect，**节点还在移动就把 `end` 往后推**（第二次渲染可能在没有任何结构变化的情况下重新开始一段过渡，总时长因此超过 `duration + 300`）；
   - 窗口过期后**仍以 200ms 的间隔复查位置**，直到编辑器关闭；
   - `position()` 用 `try/catch` 包起来，一次瞬时布局错误不能让循环死掉。

   有了第 3 条，任何"事件丢了 / 时长估短了 / 又平移了"都只会让修正**延迟 ≤200ms**，而不会让编辑框永久停在别处。实测（真实 Chrome + markmap 500ms 动画）：整个入场过程最大偏差 0px；动画结束后把节点凭空平移 60px，编辑框在 300ms 内跟上。

### 症状的两次迭代（别只看第一版就收工）
第一次只做了第 1 条 → 截图是"编辑框在父节点那一列"。
第二次加了第 2 条 → 截图变成"编辑框在节点的行上，但横向差 40px"，也就是**滑到一半停了**。
第三次加第 3 条才真正稳。**看到"就差一点点"的偏移，基本就是"停止跟随的时机太早"，而不是"没跟上"。**

### 验证方式（重要）
这类几何问题**单元测试证明不了**（jsdom 没有排版）。用真实浏览器量：
1. `vite` 起一个临时页面，`Markmap.create()` 渲染一棵小树（`duration: 0`、`autoFit: false`），导入 `src/editing/inline-input.ts` 的真实函数；
2. 通过 CDP 调 `openInlineInput` + `Input.insertText` 模拟输入；
3. 对比"编辑框宽高"与"用新文本重新 `setData` 后节点的宽高"。
实测（`maxWidth: 400`）：`短` 节点 16×20 → 编辑框 17×20；输入 10 个汉字 → 161×20（单行，不再折行）；提交后节点 160×20。长文本 → 编辑框 400×60，提交后节点 400×60。`zoom 2` 下 32×40 → 321×40 → 提交 320×40。

### 踩到的坑
- 提交前的 `height` 一定要先把 `height: auto` 再读 `scrollHeight`（`overflow: hidden` 时 `scrollHeight == clientHeight`，一次量大了就永久记住）。
- 编辑框漏掉 `overflow: hidden` 会预留滚动条宽度，导致刚好放得下的一行被折成两行（这次就是靠它误判了一次）。
- Electron/Obsidian 的 E2E 窗口如果没有合成器帧，`requestAnimationFrame` 不触发 → markmap 的 `renderData` 卡在 `await new Promise(requestAnimationFrame)`，所有节点 rect 都是 0×0，看起来像"点击没反应/选中失效"。用 `Page.startScreencast` 或 `Page.captureScreenshot` 喂帧，或者直接用普通 Chrome + 独立页面测几何。

## 16. 新建节点的行内编辑框不能靠"定时追踪"就位

### 症状
新建一个节点时，画面上出现两个 "New node"，而且**不重合**；回车后只剩一个。

### 根因
不是真的插入了两个节点。新建节点时输入框立刻打开（不等异步渲染/磁盘写入），这段时间它挂在**锚点节点**（新节点的父/前一个兄弟）上；等 markmap 渲染出新节点后，输入框本该"跳"到新节点上。旧实现只靠 `trackPosition()` 的定时循环（`animationDuration + 300ms`）在追位置，**追踪窗口一过就再也不更新**。真实场景里"写入队列 + 重新读文件 + 增量渲染"可能超过 800ms（大文件、慢设备、写入队列里还有别的改动），于是输入框永远停在锚点上，看起来就是两个 "New node" 相距很远。

### 正确做法（两步，缺一不可）
1. **事件驱动**：给 `openInlineInput` 传 `observe: svg`，编辑器打开期间用 `MutationObserver` 观察 mindmap 的 `childList`，任何节点增删/重渲染都重算位置；`finish()` 时 `disconnect()`。只观察 `childList`（`class`/`transform` 每帧都会被 markmap 改写）。
2. **重新装弹**：**光有事件驱动还不够**。markmap 的入场节点是先画在父节点位置、再**动画滑**到自己的位置；渲染迟到时"事件驱动"只会在动画的第 0 帧定位一次，编辑框就停在父节点那一列，而节点滑到了右边 —— 照样是"两个 New node"，只不过一个在滑动途中。所以 mutation 不能只 `position()` 一次，必须**重置追踪窗口**（`end = now + duration + 300` 并重启 rAF 循环），跟着整段动画走。

实现上两者合成一个循环：`trackPosition(input, position, duration, observe)`，内部维护 `end` 与 `running`，mutation 只负责 `end = now + window; 确保循环在跑`。

顺带把"新节点在哪里"的解析改成**路径优先、行号兜底**：
```ts
const byPath = findGroupByPath(path)          // 插入节点的路径就是新的，最精确
if (byPath && !known.has(byPath)) return byPath
const byLine = findGroupByLine(line)          // 插入兄弟节点时行号不变，但下面节点的路径整体下移
return byLine && !known.has(byLine) ? byLine : anchor
```

### 验证方式
jsdom 里可以精确复现"渲染迟到"：让 `setMarkdown` 返回一个不 resolve 的 Promise（编辑器照样立刻打开，说明没等写入），把 `performance.now` 打到 10s 之后（定时追踪失效），再模拟渲染 + `model` 更新，断言输入框的 `left` 等于新节点内容框的 `left`。位置要让每个节点在**不同列**（按先序列 × 100px），否则兄弟节点和锚点同列，测试会假通过。

**动画那一步要用真实时钟**（`vi.restoreAllMocks()`），否则冻结的 `performance.now` 会让追踪循环永远不结束，测不出"没重新装弹"的 bug：
1. `Tab` 建节点 → `setTimeout(400)` 等过初始窗口（测试里 duration=0，窗口 300ms）；
2. 渲染出新节点，先把它"放在"父节点那一列（`left: 10`），再分帧挪到 `left: 100`（模拟 d3 的 transform 补间）；
3. 断言编辑框最终 `left === '100px'`。把重新装弹去掉，这个测试必失败——这就是截图里那个 bug。

## 17. "两个 New node" 的真正根因：编辑框宽度按文本算，而不是按节点框算

### 前两轮为什么没修好（复盘）
前两轮一直在修**位置**（编辑框没跟上节点的滑动动画），但方向错了。真实 Obsidian 里用 CDP 量出来的数据是：
- 节点 `43. New node`（有序列表自动加了 `43.` 前缀）宽 **60px**；
- 编辑框显示的是源文本 `New node`（无前缀），我当时的宽度逻辑是 `editorWidth(measure(text))`，所以宽 **45px**。
- 两者 `x/y` **完全一致**（位置跟踪早就对了），但**宽度差 15px**——节点从编辑框右边戳出来一截，看起来就是"两个框没重合"。

也就是说：截图里那个"没重合"，**不是位置没跟上，而是宽度没盖住节点**。前两轮的"跟动画"修复都没错，但都没碰到真正的病根。

### 根因
编辑框的宽度被设置成"源文本宽度"，但节点渲染出来可能比源文本宽：有序列表的 `43.` 前缀、行内图片、强调标记等等。宽度差多少，节点就露出多少。

### 修复
宽度逻辑改成和高度对称的"先贴节点、后跟文本"：
- **没输入过**：`width = max(nodeRect.width, MIN)` —— 编辑框完整盖住节点框；
- **输入过之后**：`width = editorWidth(measure(text), maxWidth)` —— 跟着文本涨缩。

实测（真实 Obsidian）：新建节点后 `node: w=58 h=12 x=428 y=440`，`editor: w=58 h=12 x=428 y=440` —— **逐像素一致**，两个框完全重合。

### 教训
- **别只盯"动画/异步"**：看到"没重合"，先量两边的 `getBoundingClientRect()`，把 x/y 和 w/h 分开看。位置对、宽度不对，是另一个 bug。
- **有序列表会让渲染文本 ≠ 源文本**（`43. New node` vs `New node`）。凡是拿"源文本"给渲染框定尺寸的地方，都可能被这类前缀/标记坑。
- **E2E 必须用当前构建的 main.js**：这次排障中途发现 E2E vault 里的 main.js 是旧的（`9727c76b`），量出来的 120px 宽度一度把我带偏。拷贝前先 `md5sum` 比对。

## 18. 移动节点也要走增量渲染（remove + insert），否则折叠状态全丢

### 背景
`tree-updater` 让 insert/remove/setText 走增量渲染（`reconcile` + `renderData`），复用旧节点对象与 DOM，从而保留**折叠状态**。但移动（拖拽、J/K、剪切粘贴）一直只调 `applyChange(markdown)` 不带 edits，于是走全量 `setData`——整棵树重建，**所有折叠状态重置**。

### 修复
一个节点移动 = 一条 `remove` + 一条 `insert`：
```ts
await applyChange(result.markdown, [
  { type: 'remove', path: source },
  { type: 'insert', path: dest },
])
```
- `reorderSelection`（J/K）：dest 就是 `targetPath`（已知）。
- `moveTo`（拖拽）/ `pasteInto`（单节点粘贴）：dest 用 `pathAtLine(parseSource(newMd), result.line)` 从结果反查。
- 多节点粘贴暂仍走全量（dest 路径计算较繁琐），单节点是常见路径已覆盖。

### 关键结论（测试验证过）
`reconcile` 对 `remove+insert` 的"同路径碰撞"是**良性的**：被移动的旧节点和它邻居的 `shiftedPath` 会撞到同一个 key，`Map.set` 后写覆盖前写，留下邻居 → 邻居复用（保留折叠），被移动节点重建（丢自己的折叠）。**结果是正确的树，且比全量 `setData` 严格更好**（以前连邻居的折叠也丢）。被移动节点自身丢折叠可接受，后续可给 `TreeEdit` 加 `move` 类型来完整保留。

### 教训
- `shiftedPath` 只认"插入新节点 / 删除旧节点"，把移动表达成这两者时，被移动节点的旧 path 一定和邻居撞 key——**这是特性不是 bug**。
- `moveNode` 只返回 `{markdown, line}`，要用 `pathAtLine` 把结果行号反查回 tree path（新加的 helper，见 `source-tree.ts`）。

## 19. 新建节点后高亮闪一帧：markmap 的 ResizeObserver 会补一次 renderData

### 现象
真实 Obsidian 里新建节点，`.advmm-selected` 先上、**闪一下（约一帧）又恢复**。逐帧采样（页面内 rAF 循环）：
```
t=9   exists, sel=false  ← 新节点出现（增量 renderData 同步部分）
t=14  exists, sel=true   ← MutationObserver + rAF 恢复高亮
t=126 exists, sel=false  ← 高亮又被拿掉！
t=142 exists, sel=true   ← 再次恢复
```

### 根因（用 CDP hook `markmap.renderData/setData` + 页面内 class observer 定位）
1. 新建节点走增量 `renderData`，markmap 的 `z.merge($).attr("class", ...)` **每次都会重写所有节点的 class**（不只是新节点），所以 `.advmm-selected` 被抹掉。
2. 我们的 MutationObserver 观察到 class 变化后，在 **`requestAnimationFrame`** 里重新 `applyHighlight`——要等一帧（~16ms）。
3. 更隐蔽的：markmap 构造函数里有 `new ResizeObserver(debounce(() => this.renderData(), 100))`。新节点 content 被测量后，**100ms 后 markmap 自己又补一次 `renderData`**，把所有节点 class 再重写一遍 → 高亮第二次被抹掉。
4. 第二次 renderData 与 `fileChanged`（editor-change debounce 300ms → `view.render`）**无关**；后者在内容一致时被 `treeUpdater.isCurrent` 拦截（SKIP），是安全的。

### 修复
把高亮重上从 rAF 改成**微任务**（`queueMicrotask`）：
```ts
highlightScheduled = true
queueMicrotask(() => { highlightScheduled = false; applyHighlight() })
```
- MutationObserver 回调本来就是微任务、且批量交付；rAF 的"合并同帧 mutation"作用并不需要。
- `applyHighlight` 只写真正变化的 class（`classList.contains(cls) === want` 就跳过），所以它自己写的 class 触发 observer 后，下一轮是空转，不会死循环。
- 效果：修复后逐帧采样只剩 `t=8 {exists:true, sel:true}`，**闪烁完全消失**（重写和高亮恢复落在同一微任务 turn）。

### 教训
- **高亮/样式“重上”不要用 rAF**：rAF 一帧的延迟在“渲染器先重写、再等回调恢复”的路径上会变成可见闪烁。用微任务，与 DOM mutation 同 turn。
- **markmap 有自己的 ResizeObserver → renderData 二次渲染**（100ms debounce），会覆盖 class；排查“class 被改回去”时先怀疑它，而不是自己的渲染队列。
- 诊断时序用**页面内 rAF 采样器 + class observer**，比 CDP 外部轮询可靠（外部 evaluate 往返会掩盖同一帧内的变化）。

## 20. 折叠/展开后视图适配：用 markmap.fit() 替代 centerSubtree

### 现象
折叠（`zc`/`zC`）或展开（`zo`/`zO`）后，此前调用 `centerNode` → `centerSubtree(markmap, node)`：
- 固定 zoom 到 **1.0x**，不管内容多大、不管视口多小；
- 焦点跳到一个特定节点的子树上，整个树的其余部分可能被切掉；
- 与工具栏「Fit window size」按钮的行为不一致——用户点击 fit 能看到全部内容，但按 `zc` 后却被拉到一个节点附近。

### 修复
给 `NodeEditorOptions` 增加 `fitContent?: () => Promise<void>`，在 `editor-wiring.ts` 中直接接 `() => markmap.fit()`。`recenterAfterFold()` 改为只调用 `fitContent()`：
- `markmap.fit()` 会计算全图 bounds（`state.rect`），按 `fitRatio` 计算最优 scale，然后 animated transition 到新视口。
- 适配所有 fold/unfold 命令，无需区分选中节点还是整树。

### 关键结论
- `centerSubtree` 仍保留给 `Shift+M`（中心所选节点）——这是编辑时才需要的手动定位；折叠后的视野调整是“展示变化后的全图”，用 fit 语义更正确。
- 这个改动不影响渲染性能：`fit()` 只是改 transform，不触发布局。

## 21. 新节点编辑框高异常（两个 New node 高框）

### 现象
创建新节点后，内联编辑输入框特别高，与退出编辑模式后节点形状差异很大。

### 根因
`position()` 曾用 `rect.height` 作为编辑框初始高度。新建节点时 `getRect` 返回的是锚点节点（父/兄）的 rect——可能是根节点大字号，或含 `nodeMinHeight` padding——编辑框被无故撑高。

### 修复
1. **高度** → 始终内容驱动：`Math.max(rect.lineHeight ?? 0, input.scrollHeight)`，不参考 `rect.height`
2. **宽度** → `trustRect` 参数区分：已存在节点初始用 `rect.width` 覆盖有序列表前缀；新节点（`trustRect: false`）直接用内容测量

### 关键结论
- 编辑框不应信任非自身节点的 rect 尺寸；高度永远以内容为准
- `trustRect` 区分「覆盖有序列表前缀」和「锚点污染」两种场景

## 22. 新节点动画抖动：position() 的 layout thrashing + CSS transitions

### 现象
创建新节点时编辑框有明显抖动。

### 根因（两层）
1. `trackPosition` 每帧（rAF / 60fps）调 `position()`，该函数做 3 次 layout read：`getBoundingClientRect`（节点位置）+ mirror 幅宽 + `scrollHeight`（高）。markmap d3 transition 期间每次 read 都 force reflow，与 GPU transition 互咬致卡帧。
2. Obsidian 主题可能给 textarea 加 CSS transition；编辑框位置每帧变更时，CSS 插值让它追不上节点，视觉上形成拖尾抖动。

### 修复
1. **保留 rAF**（与浏览器渲染周期同步）但 `position()` 增加 `fast` 模式：动画窗口期间只读 `getBoundingClientRect`（left/top），跳过 mirror 测量和 scrollHeight；闲时才补完整测量。每帧 layout read 从 3 降到 1。
2. 编辑框显式设 `transition: none`，阻止主题 CSS transition 插值。

### 关键结论
- 先用 rAF 再减重，而非换 setTimeout（setTimeout 不同步渲染周期，反而产生追不上节点的拖尾感）
- 跟踪循环中只读位置、跳过尺寸 → position(fast) 模式
- `position: fixed` 元素必须设 `transition: none` 避免被主题污染


## 23. Enter 按键后延迟大：selectOnly 执行太晚

### 现象
按 Enter 提交编辑后，到 markmap 动画之间有明显延时空白期。Tab 没有这个问题。

### 根因
`saveText` → `await commit()` → `applyChange` → `setMarkdown` → `writeMarkdown` → `render` → markmap transition（500ms）。`selectOnly(path)`（高亮节点，给用户即时视觉反馈）在 `await commit()` **之后**才执行。
用户按 Enter 后：编辑框消失 → 无高亮、无反馈 → 等 500ms animation 完 → 才有高亮。这 500ms 空白期就是用户感知的「延迟」。
Tab 不受影响：`editNewNode` 第一时间就 `selectOnly(path)` + `openTextEditor`，不依赖 async chain。

### 修复
把 `selectOnly(path)` 移到 `await commit(...)` **之前**：先高亮，再异步提交。

### 关键结论
- 所有用户可见的状态变更（高亮、选中、编辑框）应同步执行，不放入 async chain 之后
- 异步部分（渲染、磁盘写入）只影响后台，不应阻塞即时视觉反馈


## 24. 折叠/展开动画「特别快」：renderData 不等待 transition

### 现象
折叠或展开节点后，动画特别快（不如以前平滑），节点瞬间就位。

### 根因
`markmap.renderData()` 是 async 函数，但内部**不 await 任何 d3 transition**。唯一 await 是一个 `requestAnimationFrame`（等一帧再 _relayout），transition 创建后函数立即 resolve。
所以 `recenterAfterFold()` → `fitContent()` 在 transition 还没跑完时就启动了 zoom 动画。**节点位移 transition 和视口缩放 transition 同时跑**，两个 500ms 动画重叠，感知上反而是「很快」（因为没有单一的平滑过渡）。

### 修复
`recenterAfterFold()` 里用 `setTimeout(fitContent, duration)` 延迟，等折叠 transition 跑完（500ms）后再启动 fit。最终效果：折叠动画 → 500ms 等 → fit 动画 → 两段平滑衔接。

### 关键结论
- 不要假设 d3 transition 的创建就等于完成；`transition.end()` 才 wait
- 两段动画重叠会让感知变「快且跳」，而非「平滑」
- markmap 的 `renderData()` 不 await transition → 外部必须自己补齐时序

## 清理清单（定期执行）

- [x] 删除被 supersede 的临时补丁文件（`fold-state.ts`、`source-peek.ts` 已删除）
- [x] 删除 `MMNG_DEBUG` 调试日志（无残留）
- [x] 检查 `git diff --check` 无空白冲突
- [x] 移除未使用的导入（ESLint 全绿）
- [x] 搜索被替代的模块（`fold-state.ts` 已无引用并删除）
- [x] 运行 `npx tsc --noEmit && npx eslint . && npx vitest run && npm run build`
- [ ] 多节点剪切粘贴（`pasteInto`）的 dest 路径计算 + 增量渲染
- [x] 真实 Obsidian 里新建节点后 `.advmm-selected` 高亮未及时重上的时序问题（根因=markmap ResizeObserver 二次 renderData + rAF 一帧延迟，改微任务修复）
- [ ] 真实 Obsidian 里验证 codeblock 视图的增量更新
## 25. 项目重构轮次（2026-10-22）

### 已完成

1. **死代码删除**
   - 删除 `src/utilities/set.ts`（自定义 Set 类，仅一处使用 `.add()`/`.delete()`，改原生 `globalThis.Set`）
   - 删除 callbag index 中未使用的 `startWith` 导出

2. **提取 `src/editing/editor-helpers.ts`**
   - 从 `node-editor.ts` 底部提取 6 个独立工具函数（`findNodeGroup`、`findAnyNodeGroup`、`sameDropTarget`、`isTextInput`、`clearNativeSelection`、`isInteractiveTarget`）和常量 `DRAG_THRESHOLD_SQUARED`
   - 这些函数不依赖闭包状态，纯 DOM/工具逻辑

3. **`recenterAfterFold` 优化**
   - 当 `getAnimationDuration` 返回 ≤0 时，直接调 `fitContent()`，不走 `setTimeout`（便于测试且无意义延迟）
   - 所有 fold 测试加 `getAnimationDuration: () => 0`

### 结果
- `node-editor.ts`：2724 → 2668 行（减少 56 行）
- 新增 `src/editing/editor-helpers.ts`（49 行）
- 47/686 测试全通过，TypeScript + ESLint 全绿
- 构建 `20261022-091629`

### 待续
- 进一步拆分 `node-editor.ts` 的大子系统（drag、search-ui、clipboard、history、text-editor）
- 简化 callbag 模块（仍被 4 个文件使用，是下一个候选）

## 26. `gd` 跳转到 Markdown 源文件对应行

### 功能
快捷键 `g` + `d`（vim 风格 go-to-definition）：选中节点后按 `gd`，打开 markdown 源文件并定位到该节点对应的行。

### 实现要点
1. **keymap.ts**：新增 `GOTO_PREFIX = 'g'`
2. **node-editor.ts**：`handleGoToDefSequence()` 处理 `g` 前缀；`goToDefinition(path)` 通过 `sourceRoots()` 查找节点的 `SourceNode.line` 并调用 `goToSourceLine(line)`
3. **NodeEditorOptions**：新增 `goToSourceLine?: (line: number) => void` 可选回调
4. **markdown-split.ts**：新增 `goToLine(line)` 方法，复用现有 split 或创建新 split，通过 `setEphemeralState` 定位光标
5. **editor-wiring.ts / renderer-tab.ts**：将 `markdownSplit.goToLine` 的 line 偏移计算连接到 `NodeEditorOptions.goToSourceLine`

### 关键决策
- `SourceNode.line` 是 0-based，传给编辑器时 +1 转 1-based
- 新开 split 时先用 `openFile` 打开文件，`setTimeout(100ms)` 后用 `setEphemeralState` 定位光标（Obsidian 的 MarkdownView 需要完成加载）
- 复用已有 split 时直接 `setEphemeralState` ENINDOFDOC
echo "Updated LESSONS.md"


## 26. gd 跳转到 Markdown 源文件对应行

### 功能
快捷键 g + d（vim 风格 go-to-definition）：选中节点后按 gd，打开 markdown 源文件并定位到该节点对应的行。

### 实现要点
1. keymap.ts：新增 GOTO_PREFIX = 'g'
2. node-editor.ts：handleGoToDefSequence() 处理 g 前缀；goToDefinition(path) 通过 sourceRoots() 查找节点的 SourceNode.line 并调用 goToSourceLine(line)
3. NodeEditorOptions：新增 goToSourceLine?: (line: number) => void 可选回调
4. markdown-split.ts：新增 goToLine(line) 方法，复用现有 split 或创建新 split，通过 setEphemeralState 定位光标
5. editor-wiring.ts / renderer-tab.ts：将 markdownSplit.goToLine 连接到 NodeEditorOptions.goToSourceLine

### 关键决策
- SourceNode.line 是 0-based，传给编辑器时 +1 转 1-based
- 新开 split 时先用 openFile 打开文件，setTimeout(100ms) 后用 setEphemeralState 定位光标（Obsidian 的 MarkdownView 需要完成加载）
- 复用已有 split 时直接 setEphemeralState

## 27. 新建节点的编辑框不能用「文本宽度」定尺寸（"两个框、两段文字"）

### 症状
按 `Tab` 新建节点时，输入框和它后面的节点框不重合：节点从输入框右边露出一截，露出的是节点自己那段文字的后半段（截图里是叠着的 `de`）。双击进入编辑模式则只有一个框。

### 根因
`trustRect`（LESSONS #21 为修「编辑框被锚点撑高」而加）对新节点恒为 `false`，于是编辑框宽度永远按**源文本**算：

```ts
input.style.width = max(measure(text), MIN)   // 新节点
input.style.width = max(nodeRect.width, …)    // 已有节点
```

但 markmap 渲染出来的节点可能比源文本宽。最典型的是**有序列表**：源文本 `New node`，节点渲染成 `2. New node`（前缀是渲染内容，不是编辑器的文本）。实测（真实 Obsidian + CDP）：

```
editor  w=110      (源文本 'New node')
node    w=133.54   ('2. New node')
两者 left 完全一致
```

差 23.5px 就是 `2. ` 的宽度，节点从输入框右边露出来，看起来就是「前后两段文字」。**位置跟踪一直是对的**（所以别再怀疑动画/追踪）。

### 修复
1. **动态信任 rect**：`Rect` 增加 `trustWidth` 字段。
   - 新节点还没渲染时（`resolve()` 返回锚点）→ `trustWidth: false`，按文本宽度；
   - 一旦 `resolve()` 返回真正的节点 → `trustWidth: true`，宽度取 `max(节点框宽, 文本宽)`，与普通编辑完全一致。
   - 不要用「有没有传 resolve」来判断（`trustRect: !resolve` 就是这么错的），要看**当前这一帧量到的到底是不是目标节点**。
2. **隐藏节点自身文本**：`Rect` 增加 `mask`（该节点的 `.markmap-foreign`），编辑期间设 `visibility: hidden`，关闭时还原原值。
   - 输入框成了画面上唯一的一份文字，任何宽度/位置/动画时序差异都不可能再显示两段文字；
   - `visibility: hidden` 不影响布局，`getBoundingClientRect()` 照旧，编辑框仍能精确贴在节点框上；
   - 每次 `position()` 都重新设一遍（markmap 重渲染会重建内容），`fast` 路径也要设（新建节点时 mask 目标会从锚点切换到新节点）。
3. `position(fast)` 在「刚切到真节点」（`trustWidth` 变化）时强制走一次完整测量，否则要等 200ms 的空闲复查才会变宽，那段时间节点还会露尾巴。

### 验证（真实 Obsidian + CDP）
- 新建节点：`editor` 与 `node` 的 `left/top/width/height` **逐像素相同**（`133.54×35.33`），节点 `visibility: hidden`；
- 双击编辑同一节点：截图与新建时**像素级一致**（`0` diff）；
- 输入文字时仍按文本收缩（LESSONS #17 的行为不变），提交后节点文本恢复显示。

### 教训
- **只要画面上有两个可能重叠的文字副本，就必须只留一个**。靠「框刚好盖住」来遮住底层文本是脆的：宽一点、窄一点、慢一帧都会露馅。`visibility: hidden` 比阴影遮盖可靠。
- 修「前缀/渲染宽度」问题不要只改宽度公式：位置对、字号对、宽度差 20px，症状就是「两段文字」，量 `getBoundingClientRect()` 时分 w/h 和 x/y 一起看（LESSONS #17 已经踩过，这里复发了一次）。

---

## 28. 节点宽度：markmap 只有全局 maxWidth

### 教训
markmap-view 的 `maxWidth` 是**全局选项**，写在 `<svg>` 的 `--markmap-max-width` 上，所有节点共用。需求是「拖某个节点的右边缘改它自己的宽度」，不能去改这个全局变量。

### 正确做法
- 宽度**不写进 markdown**（用户明确要求笔记里不能出现 `<!-- width: 1566 -->`），而是存在插件 `data.json` 的 `nodeWidths[笔记路径][节点键]` 里；`parseNodeParams` 只忽略遗留的 `width:` 参数
- 节点键不能用行号/路径下标（插入/移动节点后全部错位），用**节点文本的 FNV-1a 哈希**；同名节点用「文档顺序里的第几个」后缀区分。`tagNodeWidthKeys()` 在 transform 时把键写进节点 payload（`advmmWidthKey`），渲染和编辑都按它查表
- 渲染后对每个节点设置**内层 label**（`.markmap-foreign > div > div`）的 `style.width`；markmap 的 `_relayout()` 用 label 的 `scrollWidth` 量宽，所以内联宽度既能让短文本撑宽节点，也能让长文本在该宽度折行
- `applyNodeWidths(svg, widths)` 返回「是否有节点变化」；有变化时调用方 `await markmap.renderData()`，否则 `fit()` 会在 ResizeObserver 的 100ms 防抖之前按旧宽度算视野
- 拖拽只用鼠标预览（直接改 label 的 style），松手才 `setNodeWidth(key, width)` 存进插件数据；键盘 `Ctrl+Shift` `+`/`-` 也一样，按键松开才存一次
- 只对**选中节点**的右边缘 6px 区域生效，避免和「拖动节点移动」冲突；光标提示 `ew-resize`
- 反向操作：右键菜单「重置节点宽度」从数据里删掉该键（`setNodeWidth(key, null)`），再重新应用并 relayout
- 宽度是**视图偏好**：不进笔记的撤销/重做历史，也不参与同步；换来的是 markdown 完全不被宽度操作污染

### 拖拽跟手
1. 每次 mousemove 先设 label 的 `width`，再**同步**把 `foreignObject` 的 `width/height` 改成 `label.scrollWidth/scrollHeight`（不经过动画），文本折行和框边缘立刻跟手；
2. 再按 rAF 节流调用 `markmap.renderData()`，并在整个拖拽手势期间把 `markmap.options.duration` 设为 0（`beginLiveLayout/endLiveLayout`），让子节点、连线和折叠圆也在一帧内跟上，而不是 500ms 缓动；
3. 松手后恢复 duration，再把宽度存进插件数据（正常动画只用于最终提交）。

### 错误模式
- 把宽度写进 markdown 的 node params 注释 → 笔记里到处是 `<!-- width: N -->`，用户明确不接受；应该存插件数据
- 用行号或 `pathKey`（下标路径）当宽度键 → 在前面插入节点、移动节点后，宽度会跑到别的节点上
- 改全局 `maxWidth` 来「调整节点宽度」→ 所有节点一起变，拖短节点还看不到任何变化
- 直接改外层 `foreignObject > div` 的宽度 → 那层是 `maxWidth` 的容器，markmap 量的是内层 label，改了没用
- 只设内联宽度而不主动 `renderData()` → 首屏 `fit()` 用的是旧布局，节点和连线在 100ms 后才跳一下
- 拖拽时只改 label 的内联宽度 → `foreignObject` 的 width/height 还是旧值，`foreignObject` 会裁剪内容：变窄时折行出来的后几行被剪掉，变宽时鼠标已经跑到可见框右边很远。拖拽体验「不跟手」的根因就在这里，不在鼠标事件
- 拖拽时直接调用 `renderData()` 但不关掉过渡 → 每个尺寸变化都带 500ms 动画，框会一直追着鼠标慢慢缓动

---

## 29. 死代码与死依赖清理

### 本轮删除
- `src/constants.ts`：`MD_VIEW_TYPE`（无人引用）
- `src/utilities/utilities.ts`：`defineLazyGetter`（单数版，只被 `defineLazyGetters` 内部使用，已内联）
- `src/utilities/callbag/index.ts` + `src/types/callbag.d.ts`：未使用的 callbag 操作符 `of`、`pairwise`、`take`、`startWith`、`replay-all` 的导入/再导出/类型声明
- `src/editing/node-editor.ts`：`removePaths` 里重复的 `container?.focus()`
- `package.json`：`ramda`、`@types/ramda` 及 6 个无人引用的 callbag 包（`callbag-of` / `callbag-pairwise` / `callbag-take` / `callbag-toolkit` / `callbag-start-with` / `callbag-replay-all`）

### 方法
- 用 `ts-prune` 找出「导出但无人引用」的符号；区分「真死代码」（无任何引用）与「仅模块内使用」（只是过度导出，不删）
- `src/test-utils/obsidian.ts` 里的 `Notice`/`Platform`/`getLanguage`/`getFrontMatterInfo` 被 vitest 的 `obsidian` alias 使用，`ts-prune` 看不到 alias，**不是死代码**
- `@codemirror/state` / `@codemirror/view` 是 `obsidian` 的 peerDependencies（`obsidian.d.ts` 直接 import），不能删

### 验证
`npx tsc --noEmit`、`npx eslint .`、`npx vitest run`（52 文件 / 752 用例）、`npm run build` 全绿。
