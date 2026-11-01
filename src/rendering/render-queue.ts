/** Serial rendering with a single latest pending job; callers share its result. */
export function latestRenderQueue() {
  type Waiter = { resolve: () => void, reject: (error: unknown) => void }
  let pending: { run: () => void | Promise<void>, waiters: Waiter[] } | null = null
  let running = false
  let destroyed = false

  async function drain() {
    while (pending && !destroyed) {
      const job = pending
      pending = null
      try {
        await job.run()
        for (const waiter of job.waiters) waiter.resolve()
      }
      catch (error) {
        for (const waiter of job.waiters) waiter.reject(error)
      }
    }
    running = false
  }

  return {
    schedule(run: () => void | Promise<void>): Promise<void> {
      if (destroyed) return Promise.resolve()
      const promise = new Promise<void>((resolve, reject) => {
        if (pending) {
          pending.run = run
          pending.waiters.push({ resolve, reject })
        }
        else pending = { run, waiters: [{ resolve, reject }] }
      })
      if (!running) {
        running = true
        void Promise.resolve().then(drain)
      }
      return promise
    },
    destroy() {
      destroyed = true
      if (pending) for (const waiter of pending.waiters) waiter.resolve()
      pending = null
    },
  }
}
