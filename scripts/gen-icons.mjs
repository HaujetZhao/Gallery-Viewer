// 把 public/icon.svg 渲染成 PWA 需要的 192/512 PNG(maskable 占位)。
// 用 @resvg/resvg-js(纯 Rust/WASM,Windows 友好,无系统依赖)。
// 跑法:npm run icons   换 svg 后重跑即可。
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const svg = readFileSync(resolve(root, 'public/icon.svg'), 'utf-8');

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: '#2d3e50',
  });
  writeFileSync(resolve(root, 'public', name), resvg.render().asPng());
  console.log(`✓ generated public/${name} (${size}×${size})`);
}
