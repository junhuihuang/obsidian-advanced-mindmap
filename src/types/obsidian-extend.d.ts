import 'obsidian'
import { App } from 'obsidian'

declare global {
	var app: App
}


declare module 'obsidian' {

  interface MarkdownPreviewView {
    rerender(full?: boolean): void;
  }
  interface App {
    viewRegistry: ViewRegistry;
    embedRegistry: EmbedRegistry;
  }
  interface ViewRegistry {
    typeByExtension: Record<string, string>;
    viewByType: Record<string, ViewCreator>;
    getTypeByExtension(ext: string): string | undefined;
    getViewCreatorByType(type: string): ViewCreator | undefined;
    isExtensionRegistered(ext: string): boolean;
    registerExtensions(exts: string[], type: string): void;
    registerViewWithExtensions(
      exts: string[],
      type: string,
      viewCreator: ViewCreator,
    ): void;
    unregisterExtensions(exts: string[]): void;
    unregisterView(viewType: string): void;
  }

  interface EmbedInfo {
    app: App;
    containerEl: HTMLDivElement;
    depth: number;
    displayMode: boolean;
    linktext: string;
    showInline: boolean;
    sourcePath: string;
  }
  interface EmbedCreator {
    (info: EmbedInfo, file: TFile, subpath: string): EmbedComponent;
  }
  interface EmbedRegistry {
    embedByExtension: Record<string, EmbedCreator>;
    registerExtension(ext: string, creator: EmbedCreator): void;
    registerExtensions(exts: string[], creator: EmbedCreator): void;
    unregisterExtensions(exts: string[]): void;
    unregisterExtension(ext: string): void;
  }
  interface EmbedComponent extends Component {
    loadFile(): unknown;
  }

  export class CustomCss extends Component {
    // Properties
    app: App
    boundRaw()
    csscache: Map<unknown, unknown>
    enabledSnippets: Set<unknown>
    extraStyleEls: HTMLStyleElement[]
    oldThemes: Theme[]
    queue: unknown
    requestLoadSnippets()
    requestLoadTheme()
    requestReadThemes()
    snippets: unknown[]
    styleEl: HTMLStyleElement
    theme: string
    themes: Record<string, Theme>
    updates: unknown
    _children: unknown[]
    _events: CallableFunction[]
    _loaded: boolean

    // Methods
    constructor(t)

    checkForUpdate(e)
    checkForUpdates()
    disableTranslucency()
    downloadLegacyTheme(e)
    enableTranslucency()
    getManifest(e)
    getSnippetPath(e)
    getSnippetsFolder()
    getThemeFolder()
    getThemePath(e)
    hasUpdates()
    installLegacyTheme(e)
    installTheme(e,t)
    isThemeInstalled(e)
    loadCss(e)
    loadData()
    loadSnippets()
    loadTheme(e)
    onRaw(e)
    onload()
    readSnippets(e)
    readThemes(e)
    removeTheme(e)
    // Sets the app theme
    setTheme(theme: string)
    setTranslucency(e)

    setCssEnabledStatus(snippetName: string, enabled: boolean): void
  }
  
  export type Theme = {
    author: string
    authorUrl: string
    dir: string
    fundingUrl: string
    minAppVersion: string
    name: string
    version: string
  }

  export interface App {
    account: unknown
    appId: string
    appMenuBarManager: unknown
    commands: unknown
    customCss: CustomCss
    dom: unknown
    dragManager: unknown
    embedRegistry: unknown
    fileManager: FileManager
    foldManager: unknown
    hotkeyManager: unknown
    internalPlugins: unknown
    isMobile: boolean
    keymap: Keymap
    /**
     * The last known user interaction event, to help commands find out what modifier keys are pressed.
     */
    lastEvent: UserEvent | null
    loadProgress: unknown
    metadataCache: MetadataCache
    mobileNavbar: unknown
    mobileToolbar: unknown
    nextFrameEvents: unknown
    nextFrameTimer: unknown
    plugins: unknown
    scope: Scope
    setting: unknown
    shareReceiver: unknown
    statusBar: unknown
    title: string
    vault: Vault
    viewRegistry: unknown
    workspace: Workspace

    
    // Methods:

    adaptToSystemTheme()
    changeTheme(e)
    copyObsidianUrl(e)
    disableCssTransition()
    emulateMobile(e)
    enableCssTransition()
    fixFileLinks(e)
    garbleText()
    getAccentColor()
    getAppTitle(e)
    getObsidianUrl(e)
    getTheme()
    importAttachments(e,t)
    initializeWithAdapter(t)
    loadLocalStorage(e)
    nextFrame(e)
    nextFrameOnceCallback(e)
    nextFramePromise()
    // The same as app.workspace.on
    on(e,t,n)
    onMouseEvent(e)
    onNextFrame(e)
    openHelp()
    openVaultChooser()
    openWithDefaultApp(e)
    registerCommands()
    registerQuitHook()
    saveAttachment(e,t,n)
    saveLocalStorage(e,t)
    setAccentColor(e)
    setAttachmentFolder(e)
    setTheme(e)
    showInFolder(e)
    showReleaseNotes(e)
    updateAccentColor()
    updateFontFamily()
    updateFontSize()
    updateInlineTitleDisplay()
    updateTheme()
    updateViewHeaderDisplay()
  }

  export interface Workspace extends Events {
    trigger(name: 'hover-link', data: {
      event: MouseEvent
      source: string
      hoverParent: Element
      targetEl: Element
      linktext: string
    })

    /**
     * A component managing the current editor. This can be null
     * if the active view has no editor.
     * @public
     */
    activeEditor: MarkdownFileInfo | null

    /**
     * Indicates the currently focused leaf, if one exists.
     *
     * Please avoid using `activeLeaf` directly, especially without checking whether
     * `activeLeaf` is null.
     *
     * The recommended alternatives are:
     * - If you need information about the current view, use {@link getActiveViewOfType}.
     * - If you need to open a new file or navigate a view, use {@link getLeaf}.
     *
     * @public
     * @deprecated - The use of this field is discouraged.
     */
    activeLeaf: WorkspaceLeaf | null

    activeTabGroup: WorkspaceTabs | null

    /**
     * @public
     */
    leftSplit: WorkspaceSidedock | WorkspaceMobileDrawer
    /**
     * @public
     */
    rightSplit: WorkspaceSidedock | WorkspaceMobileDrawer
    /**
     * @public
     */
    leftRibbon: WorkspaceRibbon
    /**
     * @public
     */
    rightRibbon: WorkspaceRibbon
    /**
     * @public
     */
    rootSplit: WorkspaceRoot
    /**
     * @public
     */
    containerEl: HTMLElement
    /**
     * @public
     */
    layoutReady: boolean

    layoutItemQueue: []
    /**
     * @public
     */
    requestSaveLayout: Debouncer<[], Promise<void>>

    /**
     * Runs the callback function right away if layout is already ready,
     * or push it to a queue to be called later when layout is ready.
     * @public
     * */
    onLayoutReady(callback: () => unknown): void
    /**
     * @public
     */
    changeLayout(workspace: unknown): Promise<void>

    /**
     * @public
     */
    getLayout(): unknown

    /**
     * @public
     */
    createLeafInParent(parent: WorkspaceParent, index: number): WorkspaceLeaf

    /**
     * The index does nothing. It always adds tabs on the right.
     * Use createLeafInParent if you need to place tabs at a specific index.
     * @public
     */
    createLeafInTabGroup(parent: WorkspaceTabs, index: number): WorkspaceLeaf

    /**
     * @public
     */
    createLeafBySplit(leaf: WorkspaceLeaf, direction?: SplitDirection, before?: boolean): WorkspaceLeaf
    /**
     * @public
     * @deprecated - You should use {@link getLeaf|getLeaf(true)} instead which does the same thing.
     */
    splitActiveLeaf(direction?: SplitDirection): WorkspaceLeaf

    /**
     * @public
     * @deprecated
     */
    duplicateLeaf(leaf: WorkspaceLeaf, direction?: SplitDirection): Promise<WorkspaceLeaf>
    /**
     * @public
     */
    duplicateLeaf(leaf: WorkspaceLeaf, leafType: PaneType | boolean, direction?: SplitDirection): Promise<WorkspaceLeaf>
    /**
     * @public
     * @deprecated - You should use {@link getLeaf|getLeaf(false)} instead which does the same thing.
     */
    getUnpinnedLeaf(type?: string): WorkspaceLeaf
    /**
     * Creates a new leaf in a leaf adjacent to the currently active leaf.
     * If direction is `'vertical'`, the leaf will appear to the right.
     * If direction is `'horizontal'`, the leaf will appear below the current leaf.
     *
     * @public
     */
    getLeaf(newLeaf?: 'split', direction?: SplitDirection): WorkspaceLeaf
    /**
     * If newLeaf is false (or not set) then an existing leaf which can be navigated
     * is returned, or a new leaf will be created if there was no leaf available.
     *
     * If newLeaf is `'tab'` or `true` then a new leaf will be created in the preferred
     * location within the root split and returned.
     *
     * If newLeaf is `'split'` then a new leaf will be created adjacent to the currently active leaf.
     *
     * If newLeaf is `'window'` then a popout window will be created with a new leaf inside.
     *
     * @public
     */
    getLeaf(newLeaf?: PaneType | boolean): WorkspaceLeaf

    /**
     * Migrates this leaf to a new popout window.
     * Only works on the desktop app.
     * @public
     */
    moveLeafToPopout(leaf: WorkspaceLeaf, data?: WorkspaceWindowInitData): WorkspaceWindow

    /**
     * Open a new popout window with a single new leaf and return that leaf.
     * Only works on the desktop app.
     * @public
     */
    openPopoutLeaf(data?: WorkspaceWindowInitData): WorkspaceLeaf
    /**
     * @public
     */
    openLinkText(linktext: string, sourcePath: string, newLeaf?: PaneType | boolean, openViewState?: OpenViewState): Promise<void>
    /**
     * Sets the active leaf
     * @param leaf - The new active leaf
     * @param params
     * @public
     */
    setActiveLeaf(leaf: WorkspaceLeaf, params?: {
        /** @public */
        focus?: boolean;
    }): void
    /**
     * @deprecated - function signature changed. Use other form instead
     * @public
     */
    setActiveLeaf(leaf: WorkspaceLeaf, pushHistory: boolean, focus: boolean): void

    /**
     * @public
     */
    getLeafById(id: string): WorkspaceLeaf
    /**
     * @public
     */
    getGroupLeaves(group: string): WorkspaceLeaf[]

    /**
     * @public
     */
    getMostRecentLeaf(root?: WorkspaceParent): WorkspaceLeaf | null
    /**
     * @public
     */
    getLeftLeaf(split: boolean): WorkspaceLeaf
    /**
     * @public
     */
    getRightLeaf(split: boolean): WorkspaceLeaf

    /**
     * @public
     */
    getActiveViewOfType<T extends View>(type: Constructor<T>): T | null

    /**
     * Returns the file for the current view if it's a FileView.
     *
     * Otherwise, it will recent the most recently active file.
     *
     * @public
     */
    getActiveFile(): TFile | null

    /**
     * Iterate through all leaves in the main area of the workspace.
     * @public
     */
    iterateRootLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void
    /**
     * Iterate through all leaves, including main area leaves, floating leaves, and sidebar leaves.
     * @public
     */
    iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void
    /**
     * @public
     */
    getLeavesOfType(viewType: string): WorkspaceLeaf[]
    /**
     * @public
     */
    detachLeavesOfType(viewType: string): void

    /**
     * @public
     */
    revealLeaf(leaf: WorkspaceLeaf): void
    /**
     * @public
     */
    getLastOpenFiles(): string[]
    /**
     * Calling this function will update/reconfigure the options of all markdown panes.
     * It is fairly expensive, so it should not be called frequently.
     * @public
     */
    updateOptions(): void

    /**
     * @public
     */
    iterateCodeMirrors(callback: (cm: CodeMirror.Editor) => unknown): void

    /**
     * @public
     */
    on(name: 'quick-preview', callback: (file: TFile, data: string) => unknown, ctx?: unknown): EventRef
    /**
     * @public
     */
    on(name: 'resize', callback: () => unknown, ctx?: unknown): EventRef
    /**
     * @public
     */
    on(name: 'click', callback: (evt: MouseEvent) => unknown, ctx?: unknown): EventRef
    /**
     * @public
     */
    on(name: 'active-leaf-change', callback: (leaf: WorkspaceLeaf | null) => unknown, ctx?: unknown): EventRef

    /* file is null when an empty tab is opened. */
    on(name: 'file-open', callback: (file: TFile | null) => unknown, ctx?: unknown): EventRef

    /**
     * @public
     */
    on(name: 'layout-change', callback: () => unknown, ctx?: unknown): EventRef
    /**
     * @public
     */
    on(name: 'window-open', callback: (win: WorkspaceWindow, window: Window) => unknown, ctx?: unknown): EventRef
    /**
     * @public
     */
    on(name: 'window-close', callback: (win: WorkspaceWindow, window: Window) => unknown, ctx?: unknown): EventRef
    /**
     * Triggered when the CSS of the app has changed.
     * @public
     */
    on(name: 'css-change', callback: () => unknown, ctx?: unknown): EventRef
    /**
     * Triggered when the user opens the context menu on a file.
     * @public
     */
    on(name: 'file-menu', callback: (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => unknown, ctx?: unknown): EventRef

    /**
     * Triggered when the user opens the context menu on an editor.
     * @public
     */
    on(name: 'editor-menu', callback: (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => unknown, ctx?: unknown): EventRef
    /**
     * Triggered when changes to an editor has been applied, either programmatically or from a user event.
     * @public
     */
    on(name: 'editor-change', callback: (editor: Editor, info: MarkdownView | MarkdownFileInfo) => unknown, ctx?: unknown): EventRef
    /**
     * Triggered when the editor receives a paste event.
     * Check for `evt.defaultPrevented` before attempting to handle this event, and return if it has been already handled.
     * Use `evt.preventDefault()` to indicate that you've handled the event.
     * @public
     */
    on(name: 'editor-paste', callback: (evt: ClipboardEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => unknown, ctx?: unknown): EventRef
    /**
     * Triggered when the editor receives a drop event.
     * Check for `evt.defaultPrevented` before attempting to handle this event, and return if it has been already handled.
     * Use `evt.preventDefault()` to indicate that you've handled the event.
     * @public
     */
    on(name: 'editor-drop', callback: (evt: DragEvent, editor: Editor, info: MarkdownView | MarkdownFileInfo) => unknown, ctx?: unknown): EventRef

    /**
     * @public
     */
    on(name: 'codemirror', callback: (cm: CodeMirror.Editor) => unknown, ctx?: unknown): EventRef

    /**
     * Triggered when the app is about to quit. Not guaranteed to actually run.
     * Perform some best effort cleanup here.
     * @public
     */
    on(name: 'quit', callback: (tasks: Tasks) => unknown, ctx?: unknown): EventRef

  }

  export interface WorkspaceItem extends Events {
    containerEl: HTMLElement
    dimension?: unknown
    id: string
    parent?: WorkspaceParent
    type: WorkspaceParent['type'] | 'leaf'

    detach()
    /**
     * Get the root container parent item, which can be one of:
     * - {@link WorkspaceRoot}
     * - {@link WorkspaceWindow}
     */
    getContainer(): WorkspaceContainer
    getIcon()
    getRoot(): WorkspaceItem
    onResizeStart(e)
    serialize()
    setDimension(e)
    setParent(e)
  }

  export interface WorkspaceParent extends WorkspaceItem {
    app: App
    allowSingleChild: boolean
    autoManageDOM: boolean
    type: 'split' | 'tabs' | 'floating' | 'mobile-drawer'
    children: WorkspaceItem[]

    insertChild(index: number, child: WorkspaceItem): unknown
    recomputeChildrenDimensions(): unknown
    removeChild(a: unknown): unknown
    replaceChild(a: unknown, b: unknown): unknown
    serialize(): unknown
  }
  

  export interface WorkspaceSplit extends WorkspaceParent {
    component: Component
    direction: SplitDirection
    isResizing: boolean
    originalSizes?: unknown[]
    resizeHandleEl: HTMLElement
    resizeStartPos?: unknown
    type: 'split'
    win: Window
    workspace: Workspace
  }

  export interface WorkspaceTabs extends WorkspaceParent {
    currentTab: number
    children: WorkspaceLeaf[]
    hasLockedTabWidths: boolean
    isStacked: boolean
    type: 'tabs'
    resizeHandleEl: HTMLElement
    tabHeaderContainerEl: HTMLElement
    tabHeaderEls: HTMLElement
    tabsContainerEl: HTMLElement
    tabsInnerEl: HTMLElement

    getTabInsertLocation(a: unknown): unknown
    insertChild(index: number, child: WorkspaceLeaf): unknown
    lockTabWidths(): unknown
    onContainerScroll(): unknown
    recomputeChildrenDimensions(): unknown
    removeChild(a: unknown): unknown
    scrollIntoView(a: unknown): unknown
    selectTab(a: unknown): unknown
    selectTabIndex(a: unknown): unknown
    serialize(): unknown
    setStacked(a: unknown): unknown
    unlockTabWidths(): unknown
    updateSlidingTabs(): unknown
    updateTabDisplay(): unknown
  }

  export interface WorkspaceLeaf extends WorkspaceItem {
    activeTime: number
    app: App
    component: BaseComponent
    group?: unknown
    height: number
    history: unknown
    pinned: boolean
    resizeHandleEl: HTMLElement
    resizeObserver: ResizeObserver
    tabHeaderCloseEl: HTMLElement
    tabHeaderEl: HTMLElement
    tabHeaderInnerIconEl?: HTMLElement
    tabHeaderInnerTitleEl: HTMLElement
    tabHeaderStatusContainerEl: HTMLElement
    tabHeaderStatusLinkEl?: HTMLElement
    tabHeaderStatusPinEl?: HTMLElement
    type: 'leaf'
    view: View
    width: number
    working: boolean
    workspace: Workspace
    _: {
        'group-change': unknown[];
        'history-change': unknown[];
        'pinned-change': unknown[];
    }
    _empty: unknown


    canNavigate(): boolean
    detach(): void
    getDisplayText(): string
    getEphemeralState()
    getHistoryState()
    getIcon(): IconName
    getViewState(): ViewState
    handleDrop(e,t,n)
    highlight()
    onOpenTabHeaderMenu(e)
    onResize(): void
    open(view: View): Promise<View>
    /**
     * By default, `openFile` will also make the leaf active.
     * Pass in `{ active: false }` to override.
     */
    openFile(file: TFile, openState?: OpenViewState): Promise<void>
    openLinkText(e,t,n)
    rebuildView()
    recordHistory(e)
    serialize()
    setEphemeralState(state: unknown): void
    setGroup(group: string): void
    setGroupMember(other: WorkspaceLeaf): void
    setPinned(pinned: boolean): void
    setViewState(viewState: ViewState, eState?: unknown): Promise<void>
    togglePinned(): void
    trigger(t)
    unhighlight()
    /**
     * Calls setDisplayText() and updates the tab title.
     */
    updateHeader(): void

    on(name: 'pinned-change', callback: (pinned: boolean) => unknown, ctx?: unknown): EventRef
    on(name: 'group-change', callback: (group: string) => unknown, ctx?: unknown): EventRef
  }

  export type Recycler = (a: unknown, b: unknown) => void

  export class MarkdownPreviewRenderer {
    static codeBlockPostProcessors: Record<string, MarkdownPostProcessor>
    static postProcessors: Array<MarkdownPostProcessor>
    static recyclers: Array<Recycler>

    static belongsToMe(e: unknown, t: unknown, n: unknown): boolean
    static registerCodeBlockPostProcessor(postProcessor: MarkdownPostProcessor, sortOrder?: number): void
    static registerDomEvents(t: unknown, n: unknown, i: unknown): void
    static registerRecycler(e: Recycler): void
    static unregisterRecycler(e: Recycler): void

    addFooter(): unknown
    addHeader(): unknown
    applyFoldInfo(e: unknown): unknown
    applyScroll(e: unknown, t: unknown): unknown
    applyScrollDelayed(e: unknown, t: unknown, n: unknown): unknown
    applyScrollSection(e: unknown): unknown
    belongsToMe(t: unknown): boolean
    cleanupParentComponents(): void
    clear(): void
    foldAllHeadings(): void
    foldAllLists(): void
    getFoldInfo(): unknown
    getInternalLinkHref(e: unknown): unknown
    getScroll(): unknown
    getSectionContainer(e: unknown): unknown
    getSectionForElement(e: unknown): unknown
    getSectionInfo(e: unknown): unknown
    getSectionTop(e: unknown): unknown
    handleDetached(e: unknown): unknown
    highlightEl(e: unknown): unknown
    measureSection(e: unknown): unknown
    onCheckboxClick(e: unknown, t: unknown): unknown
    onFootnoteLinkClick(e: unknown, t: unknown): unknown
    onHeadingCollapseClick(e: unknown, t: unknown): unknown
    onListCollapseClick(e: unknown, t: unknown): unknown
    onRender(): unknown
    onRendered(e: unknown): unknown
    onResize(): unknown
    onScroll(): unknown
    parseAsync(): unknown
    parseFinish(e: unknown, t: unknown): unknown
    parseSync(): unknown
    queueRender(): unknown
    removeFooter(): unknown
    removeHeader(): unknown
    renderHighlights(e: unknown, t: unknown): unknown
    rerender(e: unknown): unknown
    selectRange(e: unknown): unknown
    set(e: unknown): unknown
    setListCollapse(e: unknown, t: unknown): unknown
    showSection(e: unknown): unknown
    unfoldAllHeadings(): unknown
    unfoldAllLists(): unknown
    updateFooter(): unknown
    updateHeader(): unknown
    updateShownSections(): unknown
    updateVirtualDisplay(e: unknown): unknown
  }


  export interface ColorComponent extends ValueComponent<string> {
    colorPickerEl: HTMLInputElement

    /**
     * @public
     */
    /**
     * @public
     */
    getValue(): HexString
    /**
     * @public
     */
    getValueRgb(): RGB
    /**
     * @public
     */
    getValueHsl(): HSL

    /**
     * @public
     */
    setValue(value: HexString): this
    /**
     * @public
     */
    setValueRgb(rgb: RGB): this
    /**
     * @public
     */
    setValueHsl(hsl: HSL): this

    /**
     * @public
     */
    onChange(callback: (value: string) => unknown): this
  }
}
