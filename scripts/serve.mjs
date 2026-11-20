import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';

const root = await realpath(fileURLToPath(new URL('../public/', import.meta.url)));
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.webp': 'image/webp', '.ico': 'image/x-icon',
};
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT 必须是有效端口号');
const server = createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const path = resolve(root, '.' + pathname, pathname.endsWith('/') ? 'index.html' : '');
    if (!path.startsWith(root + sep)) throw new Error('Invalid path');
    const target = await realpath(path);
    if (!target.startsWith(root + sep)) throw new Error('Invalid path');
    const content = await readFile(target);
    res.writeHead(200, {
      'Content-Type': mime[extname(target)] || 'application/octet-stream',
      'Content-Length': content.byteLength, 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    }).end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('未找到页面');
  }
});
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? '端口已被占用，可通过 PORT 环境变量更换端口。' : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log('研究雷达  http://127.0.0.1:' + server.address().port + '/');
});
