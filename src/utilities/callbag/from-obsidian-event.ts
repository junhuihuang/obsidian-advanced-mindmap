import type { Events } from 'obsidian'
import Callbag, { map } from '.'
import { plugin } from 'src/core/main'
import { Simplify } from 'type-fest'


// Typing could fail if target has more than 20 events
export function fromObsidianEvent<
  Target extends Events,
  Name extends GetName<Target>
>(target: Target, name: Name) {
  type OnMethod = GetOnMethod<Target>
  type OnMethodParams = OverloadedParams<OnMethod>
  type Callback = GetCallback<OnMethodParams, Name>
  type CallbackParams = Parameters<Callback>

  const stream = Callbag.create<CallbackParams>((next, error, complete) => {
    const sendArgsArray = (...args: CallbackParams) => next(args)
    // `Events.on` is overloaded per event name; the callback type above was
    // already selected by the name, so this is the one signature to call.
    const on = (target.on as unknown as OnSignature).bind(target)
    const ref = on(name, sendArgsArray as (...args: unknown[]) => void)
    plugin.registerEvent(ref)
    plugin.register(complete)
  })

  return Object.assign(stream, {
    void: () => Callbag.pipe(stream, map(() => {})),
    unary: () => Callbag.pipe(stream, map(args => args[0] as typeof args[0])),
    object: <const Keys extends MapToStrings<CallbackParams>>(...keys: Keys) =>
      Callbag.pipe(stream, map(args => zip(keys, args)))
  })
}

/** The shape every overload of `Events.on` shares. */
type OnSignature = (name: string, callback: (...args: unknown[]) => void, ctx?: unknown) => ReturnType<Events['on']>

type Zip<
  K extends readonly PropertyKey[],
  V extends readonly unknown[]
> = Simplify<{
  [I in keyof K as I extends `${number}`
    ? K[I] extends PropertyKey
      ? K[I]
      : never
    : never
  ]: I extends keyof V
     ? V[I]
     : never
}>
function zip<
  K extends readonly PropertyKey[],
  V extends readonly unknown[]
>( keys: K, values: V ): Zip<K, V> {
  const out: Record<PropertyKey, unknown> = {}
  for (let i = 0; i < keys.length; i++)
    if (i in values) out[keys[i]] = values[i]
  return out as Zip<K, V>
}


type MapToStrings<T extends unknown[]> =
  { [K in keyof T]: string }

type GetCallback<Params extends [...args: unknown[]], Name extends string> =
  Params extends [name: Name, callback: infer Callback, ...args: unknown[]]
    ? Callback : never

type GetOnMethod<Target extends Events> =
  Target['on']

type GetName<Target extends Events> =
  OverloadedParams<GetOnMethod<Target>>[0]

type OverloadedParams<T> = T extends {
  (...args: infer A1): unknown
  (...args: infer A2): unknown
  (...args: infer A3): unknown
  (...args: infer A4): unknown
  (...args: infer A5): unknown
  (...args: infer A6): unknown
  (...args: infer A7): unknown
  (...args: infer A8): unknown
  (...args: infer A9): unknown
  (...args: infer A10): unknown
  (...args: infer A11): unknown
  (...args: infer A12): unknown
  (...args: infer A13): unknown
  (...args: infer A14): unknown
  (...args: infer A15): unknown
  (...args: infer A16): unknown
  (...args: infer A17): unknown
  (...args: infer A18): unknown
  (...args: infer A19): unknown
  (...args: infer A20): unknown
} ? ( A1 | A2 | A3 | A4 | A5 | A6 | A7 | A8 | A9 | A10
    | A11 | A12 | A13 | A14 | A15 | A16 | A17 | A18 | A19 | A20
) : never
