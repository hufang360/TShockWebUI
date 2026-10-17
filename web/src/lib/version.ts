/**
 * 前端版本号（构建时由 vite `define` 注入，值取自 `web/package.json` 的 `version`）。
 * 在非 Vite 环境（如单测未注入）回退为 `dev`。
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
