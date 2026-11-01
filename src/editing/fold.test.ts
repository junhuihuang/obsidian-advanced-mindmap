import { describe, expect, it } from 'vitest'
import {
  foldCommandPlan,
  levelPlan,
  revealAll,
  revealNextLevelPlan,
  revealOneLevel,
  targetLevel,
  treeDepth,
  visibleLevel,
  type FoldNode,
  type FoldPlan,
} from './fold'

interface TestNode extends FoldNode {
  name: string
  children?: TestNode[]
}

/** A node with an optional name, children and initial fold state. */
function n(name: string, children: TestNode[] = [], folded = false): TestNode {
  return { name, children, payload: folded ? { fold: 1 } : {} }
}

/** `root` → (`a` → `a1` → `a1x`, `b`), i.e. a tree of depth 3. */
function sample(): TestNode {
  return n('root', [n('a', [n('a1', [n('a1x')])]), n('b')])
}

function applyPlan(plan: FoldPlan): void {
  for (const node of plan.fold) node.payload = { ...node.payload, fold: 1 }
  for (const node of plan.unfold) node.payload = { ...node.payload, fold: 0 }
}

function names(nodes: FoldNode[]): string[] {
  return nodes.map(node => (node as TestNode).name)
}

function planNames(plan: FoldPlan): { fold: string[]; unfold: string[] } {
  return { fold: names(plan.fold), unfold: names(plan.unfold) }
}

describe('treeDepth', () => {
  it('is 0 for a single node', () => {
    expect(treeDepth(n('root'))).toBe(0)
  })

  it('counts the deepest branch', () => {
    expect(treeDepth(sample())).toBe(3)
  })

  it('ignores the shallower branches', () => {
    expect(treeDepth(n('root', [n('a'), n('b', [n('b1', [n('b1x')])])]))).toBe(3)
  })
})

describe('visibleLevel', () => {
  it('is the tree depth when nothing is folded', () => {
    expect(visibleLevel(sample())).toBe(3)
  })

  it('is 0 when the root is folded', () => {
    expect(visibleLevel(n('root', [n('a', [n('a1')])], true))).toBe(0)
  })

  it('is the shallowest folded node depth', () => {
    const root = n('root', [n('a', [n('a1', [n('a1x')])], true)])
    expect(visibleLevel(root)).toBe(1)
  })

  it('ignores folded leaves, which hide nothing', () => {
    const root = n('root', [n('a', [n('a1')]), n('b', [], true)])
    expect(visibleLevel(root)).toBe(2)
  })

  it('ignores a fold hidden behind a shallower fold', () => {
    const root = n('root', [n('a', [n('a1', [n('a1x')], true)], true)])
    expect(visibleLevel(root)).toBe(1)
  })
})

describe('targetLevel', () => {
  it('folds one level at a time from the bottom', () => {
    expect(targetLevel(sampleWithLevel(3), 'foldLevel')).toBe(2)
    expect(targetLevel(sampleWithLevel(2), 'foldLevel')).toBe(1)
  })

  it('does not fold past the root', () => {
    expect(targetLevel(sampleWithLevel(0), 'foldLevel')).toBe(0)
  })

  it('unfolds one level at a time from the root', () => {
    expect(targetLevel(sampleWithLevel(0), 'unfoldLevel')).toBe(1)
    expect(targetLevel(sampleWithLevel(1), 'unfoldLevel')).toBe(2)
    expect(targetLevel(sampleWithLevel(2), 'unfoldLevel')).toBe(3)
  })

  it('does not unfold past the bottom', () => {
    expect(targetLevel(sampleWithLevel(3), 'unfoldLevel')).toBe(3)
  })

  it('fully expands on unfoldAll regardless of the current level', () => {
    expect(targetLevel(sampleWithLevel(0), 'unfoldAll')).toBe(3)
    expect(targetLevel(sampleWithLevel(2), 'unfoldAll')).toBe(3)
    expect(targetLevel(sample(), 'unfoldAll')).toBe(3)
  })

  it('toggles a fully expanded tree to collapsed', () => {
    expect(targetLevel(sample(), 'toggleAll')).toBe(0)
  })

  it('toggles a collapsed tree to fully expanded', () => {
    expect(targetLevel(sampleWithLevel(0), 'toggleAll')).toBe(3)
    expect(targetLevel(sampleWithLevel(2), 'toggleAll')).toBe(3)
  })
})

describe('levelPlan', () => {
  it('is empty when the tree already shows that level', () => {
    const root = sample()
    applyPlan(levelPlan(root, 2))
    expect(planNames(levelPlan(root, 2))).toEqual({ fold: [], unfold: [] })
  })

  it('folds every parent for level 0', () => {
    const root = sample()
    const plan = levelPlan(root, 0)
    expect(planNames(plan)).toEqual({ fold: ['root', 'a', 'a1'], unfold: [] })
  })

  it('keeps the root open for level 1', () => {
    const root = sample()
    const plan = levelPlan(root, 1)
    expect(planNames(plan)).toEqual({ fold: ['a', 'a1'], unfold: [] })
  })

  it('unfolds the shallower nodes when moving back up', () => {
    const root = sampleWithLevel(0)
    const plan = levelPlan(root, 2)
    // `a1` stays folded, since it hides depth 3 which is still out of view.
    expect(planNames(plan)).toEqual({ fold: [], unfold: ['root', 'a'] })
  })

  it('never folds leaves', () => {
    const root = sample()
    applyPlan(levelPlan(root, 0))
    // `a1x` and `b` have no children so they must not be touched.
    expect((root.children![0].children![0].children![0] as TestNode).name).toBe('a1x')
    expect((root.children![0].children![0].children![0].payload as { fold?: unknown } | undefined)?.fold).toBeFalsy()
    expect((root.children![1].payload as { fold?: unknown } | undefined)?.fold).toBeFalsy()
  })

  it('is idempotent', () => {
    const root = sample()
    applyPlan(levelPlan(root, 1))
    expect(planNames(levelPlan(root, 1))).toEqual({ fold: [], unfold: [] })
  })
})

describe('foldCommandPlan', () => {
  it('folds one level from the bottom on foldLevel', () => {
    const root = sample()
    expect(planNames(foldCommandPlan(root, 'foldLevel'))).toEqual({ fold: ['a1'], unfold: [] })
  })

  it('unfolds one level from the root on unfoldLevel', () => {
    const root = sampleWithLevel(0)
    expect(planNames(foldCommandPlan(root, 'unfoldLevel'))).toEqual({ fold: [], unfold: ['root'] })
  })

  it('collapses a fully expanded tree on toggleAll', () => {
    const root = sample()
    expect(planNames(foldCommandPlan(root, 'toggleAll'))).toEqual({ fold: ['root', 'a', 'a1'], unfold: [] })
  })

  it('expands a collapsed tree on toggleAll', () => {
    const root = sampleWithLevel(0)
    expect(planNames(foldCommandPlan(root, 'toggleAll'))).toEqual({ fold: [], unfold: ['root', 'a', 'a1'] })
  })

  it('expands every level on unfoldAll', () => {
    const root = sampleWithLevel(0)
    expect(planNames(foldCommandPlan(root, 'unfoldAll'))).toEqual({ fold: [], unfold: ['root', 'a', 'a1'] })
  })

  it('folds one level of a subtree when it is the command target', () => {
    // `zC` passes the selected node as the root of the level arithmetic, the
    // same way `zo` does, so the plan must be relative to that node.
    const root = sampleWithLevel(1)
    const a = root.children![0] as TestNode
    // The tree is already at level 1: folding "the tree" would close `root`,
    // while folding `a`'s subtree has nothing left to do.
    expect(planNames(foldCommandPlan(a, 'foldLevel'))).toEqual({ fold: [], unfold: [] })
    applyPlan(levelPlan(a, 2))
    expect(planNames(foldCommandPlan(a, 'foldLevel'))).toEqual({ fold: ['a1'], unfold: [] })
  })

  it('produces an empty plan when a command has nothing to do', () => {
    const root = sample()
    expect(planNames(foldCommandPlan(root, 'unfoldLevel'))).toEqual({ fold: [], unfold: [] })
  })
})

/** A sample tree folded down to show exactly `level` levels. */
function sampleWithLevel(level: number): TestNode {
  const root = sample()
  applyPlan(levelPlan(root, level))
  return root
}

describe('revealOneLevel', () => {
  it('unfolds the node and folds every child', () => {
    const root = n('root', [n('a', [n('a1', [n('a1x')])]), n('b')], true)
    revealOneLevel(root)

    expect(root.payload?.fold).toBe(0)
    for (const child of root.children ?? []) {
      expect(child.payload?.fold).toBe(1)
    }
  })

  it('folds leaves too, which is harmless', () => {
    const leaf = n('leaf')
    revealOneLevel(n('root', [leaf]))
    expect(leaf.payload?.fold).toBe(1)
  })

  it('preserves other payload fields', () => {
    const root = {
      children: [{ payload: { advmmSourcePath: [0, 0] } }],
      payload: { advmmSourcePath: [0], fold: 1 },
    } as unknown as FoldNode

    revealOneLevel(root)

    const child = root.children![0]
    expect(root.payload).toEqual({ advmmSourcePath: [0], fold: 0 })
    expect(child.payload).toEqual({ advmmSourcePath: [0, 0], fold: 1 })
  })
})

describe('revealNextLevelPlan', () => {
  it('reveals the first level of a folded subtree', () => {
    const root = n('root', [n('a', [n('a1', [n('a1x')])]), n('b')], true)
    // Every deeper parent is pre-folded so later calls walk down one level each.
    expect(planNames(revealNextLevelPlan(root))).toEqual({ fold: ['a', 'a1'], unfold: ['root'] })
  })

  it('walks one level deeper on each call', () => {
    const root = n('root', [n('a', [n('a1', [n('a1x')])])], true)

    applyPlan(revealNextLevelPlan(root))
    expect(visibleLevel(root)).toBe(1)

    applyPlan(revealNextLevelPlan(root))
    expect(visibleLevel(root)).toBe(2)
    expect(root.children![0].payload?.fold).toBe(0)

    applyPlan(revealNextLevelPlan(root))
    expect(visibleLevel(root)).toBe(3)

    // Fully expanded: nothing left to do.
    expect(planNames(revealNextLevelPlan(root))).toEqual({ fold: [], unfold: [] })
  })

  it('is a no-op on an already expanded subtree', () => {
    expect(planNames(revealNextLevelPlan(sample()))).toEqual({ fold: [], unfold: [] })
  })

  it('reveals one level below an open node with folded children', () => {
    const root = n('root', [n('a', [n('a1')], true)])
    expect(planNames(revealNextLevelPlan(root))).toEqual({ fold: [], unfold: ['a'] })
  })
})

describe('revealAll', () => {
  it('unfolds the node and every descendant', () => {
    const root = n('root', [n('a', [n('a1', [n('a1x')])], true), n('b', [], true)], true)
    revealAll(root)

    expect(root.payload?.fold).toBe(0)
    expect(root.children![0].payload?.fold).toBe(0)
    expect(root.children![0].children![0].payload?.fold).toBe(0)
    expect(root.children![0].children![0].children![0].payload?.fold).toBe(0)
    expect(root.children![1].payload?.fold).toBe(0)
  })

  it('preserves other payload fields', () => {
    const root = {
      children: [{ payload: { advmmSourcePath: [0, 0], fold: 1 } }],
      payload: { advmmSourcePath: [0], fold: 1 },
    } as unknown as FoldNode

    revealAll(root)

    expect(root.payload).toEqual({ advmmSourcePath: [0], fold: 0 })
    expect(root.children![0].payload).toEqual({ advmmSourcePath: [0, 0], fold: 0 })
  })
})
