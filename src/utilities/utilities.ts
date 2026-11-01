import autoBind from 'auto-bind'
import { Merge } from 'type-fest'

type Path<EventName> = [EventName, number]
/** A listener of an arbitrary signature: `never` accepts every parameter list. */
type Listener = (data: never) => unknown

export class LocalEvents<EventName extends string> {
  /** Listener slots: `undefined` marks one that has been unsubscribed. */
  private listeners: Record<string, (Listener | undefined)[]> = {}

  constructor() { autoBind(this) }

  public emit(name: EventName, data?: unknown) {
    const listeners = this.listeners[name]
    if (!listeners) return
    listeners.forEach(cb => cb?.((data) as never))
  }

  public listen(name: EventName): (callback: Listener) => () => void
  public listen(name: EventName, callback: Listener): () => void
  public listen(name: EventName, callback?: Listener): unknown {
    // Curry: with one argument returns a function that takes the callback;
    // with two arguments registers the callback directly.
    if (callback === undefined) {
      return (cb: Listener) => this.listen(name, cb)
    }
    const path: Path<EventName> =
      [name, this.listeners?.[name]?.length ?? 0]

    if (this.listeners[name])
      this.listeners[name].push(callback)
    else
      this.listeners[name] = [callback]

    return this.unlisten(path)
  }

  private unlisten([name, index]: Path<EventName>) {
    return () => {
      const listeners = this.listeners[name]
      if (!listeners) return
      // Clear the slot instead of splicing: other subscriptions hold indices
      // into this array, so removing an entry would shift them.
      listeners[index] = undefined
      if (listeners.every(listener => listener === undefined)) delete this.listeners[name]
    }
  }
}


declare global {
  interface PromiseConstructor {
    withResolvers<T>(): {
      promise: Promise<T>
      resolve: (value: T | PromiseLike<T>) => void
      reject: (reason?: unknown) => void
    }
  }
}
if (!Promise.withResolvers)
  Promise.withResolvers = <T,>() => {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

export const nextTick = () => Promise.resolve()

export const isObjectEmpty = (object: object) =>
  Object.keys(object).length === 0

export const iife = <Return>(fn: () => Return) => fn()

// `unknown` rather than `void` for the callback's return: several call sites
// are one-expression arrows returning a builder, and a `void` return makes them
// look like they might hand back a promise.
export function Resolve<T>(fn: (resolve: (v: T) => void) => unknown): T {
  let result!: T
  const resolve = (v: T) => result = v
  fn(resolve)
  return result
}

type AssertPredicate<In, Out extends In> = ((x: In) => x is Out) & { message?: string}
export function assert<In, Out extends In>(
  predicate: AssertPredicate<In, Out>,
  x: In,
  message?: string
): asserts x is Out {
  if (!predicate(x))
    throw new Error(message ?? predicate.message ?? predicate.toString())
}

export const notNullish = Object.assign(
  <T>(x: T): x is NonNullable<T> => x !== null && x !== undefined,
  { message: 'Must not be null or undefined' }
)

export const defineLazyGetters = <
  Obj extends object,
  Getters extends Record<string, () => unknown>
>(
  obj: Obj,
  getters: Getters
): Merge<Obj, { [K in keyof Getters]: ReturnType<Getters[K]> }> => {
  for (const key in getters)
    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: true,
      get() {
        const value = getters[key]()
        Object.defineProperty(obj, key, { value, writable: false, enumerable: true })
        return value
      }
    })
  return obj as unknown as Merge<Obj, { [K in keyof Getters]: ReturnType<Getters[K]> }>
}
