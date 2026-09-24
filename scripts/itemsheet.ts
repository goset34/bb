// Contact sheet of all non-block item sprites. Usage: npx tsx scripts/itemsheet.ts out.png [scale=4]
import { writePNG } from './png-node';
import { initRegistries } from '../src/common/init';
import { ITEM_LIST } from '../src/common/item/items';
import { Painter } from '../src/client/render/textures/painter';
import { paintItemTexture } from '../src/client/render/textures/itemtex';

initRegistries();
const [out = 'items.png', scaleArg = '4'] = process.argv.slice(2);
const scale = Number(scaleArg);
const items = ITEM_LIST.filter((i) => !i.block);
const cols = 24, cell = 16 * scale + 4;
const rows = Math.ceil(items.length / cols);
const W = cols * cell, H = rows * cell;
const img = new Uint8Array(W * H * 4);
for (let i = 0; i < W * H; i++) { const c = ((i % W) >> 3) + ((Math.floor(i / W)) >> 3); const v = c % 2 ? 150 : 170; img[i * 4] = v; img[i * 4 + 1] = v; img[i * 4 + 2] = v; img[i * 4 + 3] = 255; }
const missing: string[] = [];
items.forEach((it, k) => {
  const p = new Painter(16, it.id);
  if (!paintItemTexture(p, it.id)) { missing.push(it.id); return; }
  const ox = (k % cols) * cell + 2, oy = Math.floor(k / cols) * cell + 2;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const s = (y * 16 + x) * 4;
    const a = p.rgba[s + 3]! / 255;
    if (a === 0) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const d = ((oy + y * scale + dy) * W + ox + x * scale + dx) * 4;
      for (let c = 0; c < 3; c++) img[d + c] = img[d + c]! * (1 - a) + p.rgba[s + c]! * a;
    }
  }
});
writePNG(out, W, H, img);
console.log(`${items.length} items, missing ${missing.length}: ${missing.join(' ')}`);
