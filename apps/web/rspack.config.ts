import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@rspack/cli'
import { rspack, type Configuration } from '@rspack/core'
import { GenerateSW } from '@aaroon/workbox-rspack-plugin'

const dev = process.env.NODE_ENV !== 'production'
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const root = path.dirname(fileURLToPath(import.meta.url))
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8')
) as { version: string }

const cssLoader = {
  loader: 'builtin:lightningcss-loader',
  options: { targets },
}

type ConfigOptions = {
  /** 开发服务器配置，支持本地接口代理 */
  devServer?: Configuration['devServer']
}

/** 创建构建配置，支持自定义开发服务器选项 */
export const createConfig = ({ devServer }: ConfigOptions = {}): Configuration => ({
  mode: dev ? 'development' : 'production',
  entry: './src/main.tsx',
  output: {
    path: path.resolve(root, 'dist'),
    // 运行时按当前脚本地址推导资源路径，file:// 下异步 chunk、字体都按相对位置加载
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: dev ? 'cheap-module-source-map' : false,
  // 开发模式预编译异步模块，保持首次加载代码高亮和公式时的页面状态
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // 将 .js 导入路径解析到同名 .ts、.tsx 或 .js 文件
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    // CSS Modules 使用默认导出：`import styles from './x.module.css'`
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: dev } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new rspack.DefinePlugin({
      __SDOM_API_BASE_URL__: JSON.stringify(process.env.SDOM_API_BASE_URL ?? ''),
      __SDOM_PWA__: JSON.stringify(!dev),
    }),
    // 经典 defer 脚本支持 file:// 页面的资源加载
    new rspack.HtmlRspackPlugin({
      template: './src/index.html',
      scriptLoading: 'defer',
      meta: { 'application-version': version },
    }),
    new rspack.CopyRspackPlugin({
      patterns: [
        { from: path.resolve(root, '../../LICENSE'), to: 'LICENSE', toType: 'file' },
        { from: path.resolve(root, 'public/app-icon.svg'), to: 'app-icon.svg' },
        { from: path.resolve(root, 'public/favicon.svg'), to: 'favicon.svg' },
        { from: path.resolve(root, 'public/site.webmanifest'), to: 'site.webmanifest' },
        { from: path.resolve(root, 'public/icons'), to: 'icons' },
        { from: path.resolve(root, 'public/fonts'), to: 'fonts' },
        { from: path.resolve(root, 'public/_headers'), to: '_headers', toType: 'file' },
      ],
    }),
    ...(!dev
      ? [
          new GenerateSW({
            swDest: 'sw.js',
            cacheId: 'sdom',
            clientsClaim: false,
            skipWaiting: false,
            cleanupOutdatedCaches: true,
            navigateFallback: 'index.html',
            navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/api$/],
            runtimeCaching: [
              {
                urlPattern: /\/api(?:\/|$)/,
                handler: 'NetworkOnly',
              },
            ],
            maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
            exclude: [/^_headers$/u],
          }),
        ]
      : []),
  ],
  performance: { hints: false },
  devServer: {
    port: 8090,
    proxy: [
      {
        context: ['/api'],
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
        changeOrigin: false,
      },
    ],
    ...devServer,
  },
})

// eslint-disable-next-line import/no-default-export
export default defineConfig(createConfig())
