import assert from 'node:assert/strict'
import { build } from 'esbuild'

const { outputFiles } = await build({
  entryPoints: ['src/lib/pageLoadError.ts'], bundle: true, format: 'esm', write: false,
})
const { isPageModuleLoadError } = await import('data:text/javascript;base64,' + Buffer.from(outputFiles[0].contents).toString('base64'))

for (const message of [
  'Importing a module script failed.',
  'Failed to fetch dynamically imported module: https://example.test/assets/page.js',
  'error loading dynamically imported module',
  'Unable to preload CSS for /assets/page.css',
]) assert.equal(isPageModuleLoadError(new Error(message)), true, message)

assert.equal(isPageModuleLoadError(new TypeError("Cannot read properties of undefined (reading 'name')")), false)
assert.equal(isPageModuleLoadError(null), false)
