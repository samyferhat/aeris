import type { Plugin } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Development-only endpoint used to capture reference images from the running game.
 * POST a JSON body of { name, dataUrl } to /__shot and it lands in docs/. It exists only
 * inside the dev server, so nothing of it reaches a production build.
 */
export function screenshotPlugin(): Plugin {
  return {
    name: 'aeris-screenshot',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c as Buffer));
        req.on('end', () => {
          try {
            const { name, dataUrl } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const base64 = String(dataUrl).replace(/^data:image\/\w+;base64,/, '');
            const out = resolve(server.config.root, 'docs', String(name).replace(/[^\w.-]/g, '_'));
            mkdirSync(dirname(out), { recursive: true });
            writeFileSync(out, Buffer.from(base64, 'base64'));
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: out }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}
