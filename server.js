'use strict';
// HTTP server with no framework: JSON API + live events + the static front end in /public.
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./src/config');
const events = require('./src/events');
const service = require('./src/service');
const inbox = require('./src/inbox');
const { HttpError } = service;

const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(new HttpError(400, 'Body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  let r;
  if (m === 'GET' && p === '/api/health') return json(res, 200, { ok: true });
  if (m === 'GET' && p === '/api/state') return json(res, 200, service.snapshot());
  if (m === 'GET' && p === '/api/events') return events.add(req, res);

  if (m === 'POST' && p === '/api/mails') {
    const b = await readBody(req);
    const f = { name: str(b.name, 80), email: str(b.email, 120), subject: str(b.subject, 200), body: str(b.body, 4000), deadline: Number(b.deadline) };
    if (!f.name || !f.subject || !f.body) throw new HttpError(400, 'name, subject and body are required');
    if (!EMAIL.test(f.email)) throw new HttpError(400, 'A valid client email is required');
    r = await service.receiveMail(f, { priority: b.priority, useAI: b.useAI });
    return json(res, 201, { project: r.project, state: r.snapshot });
  }
  if (m === 'POST' && p === '/api/reset') return json(res, 200, { state: service.reset() });
  if (m === 'POST' && p === '/api/notifications/read') {
    const b = await readBody(req);
    return json(res, 200, { state: await service.markRead(str(b.to, 20)) });
  }
  const t = p.match(/^\/api\/tasks\/([\w-]+)\/(start|progress|complete|blocker|resolve|reassign|nudge)$/);
  if (m === 'POST' && t) {
    const id = t[1], b = await readBody(req);
    const map = {
      start: () => service.startTask(id),
      progress: () => service.setProgress(id, b.progress),
      complete: () => service.completeTask(id),
      blocker: () => service.raiseBlocker(id, b.text, b.severity),
      resolve: () => service.resolveBlocker(id),
      reassign: () => service.reassign(id, str(b.assignee, 20)),
      nudge: () => service.nudge(id),
    };
    return json(res, 200, { state: await map[t[2]]() });
  }
  throw new HttpError(404, 'Unknown API route');
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      return serveStatic(req, res, url);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    }
  });
}

if (require.main === module) {
  createServer().listen(config.port, () => {
    console.log(`Operations Copilot running on http://localhost:${config.port}`);
    console.log(`AI planner: ${config.anthropic.apiKey ? 'Claude (' + config.anthropic.model + ')' : 'rule-based (set ANTHROPIC_API_KEY for Claude)'}`);
    console.log(`Outgoing mail: ${config.smtp.enabled ? 'SMTP ' + config.smtp.host : 'dry-run, mails are only logged in the Outbox'}`);
    inbox.start();
  });
}
module.exports = { createServer };
