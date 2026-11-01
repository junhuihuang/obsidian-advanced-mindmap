import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import TsconfigPathsPlugin from 'tsconfig-paths-webpack-plugin'
import webpack from 'webpack'
import { type CallableWebpackConfiguration } from 'webpack-cli'

const config: CallableWebpackConfiguration = (env, argv) => ({
  mode: getMode(argv.mode),
  entry: './src/core/entry.ts',
  output: {
    path: resolve(import.meta.dirname, argv.mode === 'production' ? '.' : testPluginRoute),
    filename: 'main.js',
    libraryTarget: 'commonjs',
  },
  resolve: {
    extensions: ['.ts', '.js'],
    plugins: [new TsconfigPathsPlugin]
  },
  target: 'node',
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.ts$/,
        loader: 'esbuild-loader'
      }
    ],
  },
  plugins: [
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    copyAssets(['styles.css', 'manifest.json']),
  ],
  externals: {
    electron: 'commonjs electron',
    obsidian: 'commonjs obsidian',
  },
  // Source maps are only useful while developing. Both variants are inlined in
  // the bundle; `eval-source-map` wraps every module in `eval(...)`, which is
  // also what a plugin review's "dynamic code execution" scan looks for, so the
  // non-eval flavour is used even in development.
  devtool: argv.mode === 'development' ? 'inline-source-map' : false,
  optimization: { splitChunks: false }
})
export default config

function getMode(mode: unknown): 'development' | 'production' {
  if (mode === 'development' || mode === 'production') return mode
  throw new Error(`Expected --mode development or production, got ${String(mode)}`)
}

/**
 * Copies the plugin's static files next to `main.js`.
 *
 * A four-line `afterEmit` hook instead of `copy-webpack-plugin`: the plugin
 * pulls in `serialize-javascript`, whose published versions carry a remote code
 * execution advisory, and there is nothing here worth that trade.
 */
function copyAssets(assets: string[]): webpack.WebpackPluginInstance {
  return {
    apply(compiler) {
      compiler.hooks.afterEmit.tap('CopyAssets', compilation => {
        const outDir = compilation.outputOptions.path
        if (!outDir) return
        mkdirSync(outDir, { recursive: true })
        for (const asset of assets) {
          const from = resolve(import.meta.dirname, asset)
          const to = resolve(outDir, asset)
          // Production builds emit into the repository root, where the files
          // already are.
          if (from !== to) copyFileSync(from, to)
        }
      })
    },
  }
}

const testPluginRoute = 'test-vault/.obsidian/plugins/advanced-mindmap'
