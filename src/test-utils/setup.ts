import { installDomHelpers } from './dom-helpers'

// Tests that do not need a DOM run in the `node` environment.
if (typeof document !== 'undefined') installDomHelpers()
