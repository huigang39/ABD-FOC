import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, sep } from 'node:path';
import { createNativeApi } from './native/api.mjs';
import * as firmware from './native/firmware.mjs';
import { DebugService } from './native/debug.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(root, 'web');
const port = Number(process.env.ACTUATOR_PORT || 4317);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('ACTUATOR_PORT 必须是 1024–65535 之间的整数。');
const debug = new DebugService({ workspaceRoot: resolve(root, '..') });
const nativeApi = createNativeApi({ workspaceRoot: resolve(root, '..'), port, firmware, debug });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (await nativeApi(req, res, url)) return;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    const name = decodeURIComponent(url.pathname);
    const path = resolve(webRoot, `.${name === '/' ? '/index.html' : name}`);
    if (!path.startsWith(webRoot + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('找不到此资源。'); }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  debug.disconnect().catch(() => {}).finally(() => { server.close(); process.exit(0); });
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用。可设置 ACTUATOR_PORT 选择其他端口。` : error.message); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => { console.log(`ABD-FOC\nLocal: http://127.0.0.1:${port}/\n按 Ctrl+C 停止。`); });
