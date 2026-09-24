/** Browser entry point. */
import './client/ui/style.css';
import { App } from './client/app';

const root = document.getElementById('game')!;
const app = new App(root);
app.boot().catch((e: unknown) => {
  console.error(e);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;inset:0;margin:0;padding:1em;color:#fbb;background:#200;white-space:pre-wrap;z-index:9';
  pre.textContent = 'STRATA: error al iniciar\n\n' + String((e as Error)?.stack ?? e);
  document.body.appendChild(pre);
});
