import type { App } from 'obsidian'
import { __entry } from './entry'

/**
 * The Obsidian app this plugin runs in.
 *
 * Obsidian exposes a global `app` object, but that one is meant for debugging
 * and may be removed; the supported way to reach the app is the reference the
 * host passes to the plugin. `__entry` is filled in before any module of the
 * plugin is imported (see `core/entry.ts`).
 */
export function getApp(): App {
  return __entry.plugin.app
}
