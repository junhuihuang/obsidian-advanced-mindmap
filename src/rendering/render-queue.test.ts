import { describe, expect, it, vi } from 'vitest'
import { latestRenderQueue } from './render-queue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('latestRenderQueue', () => {
  it('renders only the newest pending request in the same turn', async () => {
    const queue = latestRenderQueue()
    const run = vi.fn()
    const requests = [1, 2, 3].map(value => queue.schedule(() => { run(value) }))
    await Promise.all(requests)
    expect(run.mock.calls).toEqual([[3]])
  })

  it('never overlaps renders and resolves superseded callers after the newest render', async () => {
    const queue = latestRenderQueue()
    const active = deferred()
    const next = deferred()
    const order: string[] = []
    const first = queue.schedule(async () => { order.push('first'); await active.promise })
    await Promise.resolve()
    const second = queue.schedule(() => { order.push('obsolete') })
    const third = queue.schedule(async () => { order.push('latest'); await next.promise })
    let finished = false
    void second.then(() => { finished = true })
    active.resolve()
    await first
    await Promise.resolve()
    expect(order).toEqual(['first', 'latest'])
    expect(finished).toBe(false)
    next.resolve()
    await Promise.all([second, third])
    expect(finished).toBe(true)
  })

  it('rejects callers on a failure but still processes subsequent renders', async () => {
    const queue = latestRenderQueue()
    const error = new Error('render failed')
    await expect(queue.schedule(() => { throw error })).rejects.toBe(error)
    const run = vi.fn()
    await queue.schedule(run)
    expect(run).toHaveBeenCalledOnce()
  })

  it('drops queued work when the owning renderer is destroyed', async () => {
    const queue = latestRenderQueue()
    const run = vi.fn()
    const pending = queue.schedule(run)
    queue.destroy()
    await pending
    await queue.schedule(run)
    expect(run).not.toHaveBeenCalled()
  })
})
