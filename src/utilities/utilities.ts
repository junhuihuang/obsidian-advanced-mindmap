import autoBind from 'auto-bind'
import { Merge } from 'type-fest'

type Path<EventName> = [EventName, number]

export class LocalEvents<EventName extends string> {
  private listeners: Record<string, Function[]> = {}

  constructor() { autoBind(this) }

  public emit(name: EventName, data?: any) {
    const listeners = this.listeners[name]
    if (!listeners) return
    listeners.forEach(cb => cb(data))
  }

  public listen(name: EventName, callback?: Function): any {
    // Curry: with one argument returns a function that takes the callback;
    // with two arguments registers the callback directly.
    if (callback === undefined) {
      return (cb: Function) => this.listen(name, cb)
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
    return () => { delete this.listeners[name][index] }
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
  Promise.withResolvers = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject } as any
  }

export const nextTick = () => Promise.resolve()

export const isObjectEmpty = (object: Object) =>
  Object.keys(object).length === 0

export const iife = <Return>(fn: () => Return) => fn()

export function Resolve<T>(fn: (resolve: (v: T) => void) => void): T {
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
  Getters extends Record<string, () => any>
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
  return obj as any
}
