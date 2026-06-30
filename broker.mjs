#!/usr/bin/env node
// cube-relay — zero-dependency, in-memory relay broker.
// Drop-in for the rulmo-relay /v0 REST contract. Run anywhere:
//   CUBE_RELAY_TOKEN=xxx node broker.mjs
// State is in-memory and namespaced by X-Workspace-Id. If the broker restarts,
// peers re-register automatically on their next heartbeat/poll (404 → re-register).
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || process.env.CUBE_RELAY_PORT || 8787);
const TOKEN = process.env.CUBE_RELAY_TOKEN || process.env.RULMO_RELAY_TOKEN || '';
const DEFAULT_WORKSPACE = process.env.CUBE_RELAY_WORKSPACE || 'company-main';
const PEER_TTL_MS = Number(process.env.CUBE_RELAY_PEER_TTL_MS || 60000); // > client heartbeat(15s)
const PRUNE_INTERVAL_MS = 15000;

if (!TOKEN) { console.error('cube-relay: CUBE_RELAY_TOKEN (or RULMO_RELAY_TOKEN) is required'); process.exit(1); }

const log = (m) => console.error(`[cube-relay] ${m}`);
const now = () => Date.now();
const normGroups = (g) => [...new Set((Array.isArray(g) ? g : []).map(x => String(x || '').trim()).filter(Boolean))];

// workspaces: Map<wsId, { peers: Map<id,peer>, tasks: Map<taskId,task> }>
const workspaces = new Map();
function ws(id) {
  const key = String(id || DEFAULT_WORKSPACE);
  let w = workspaces.get(key);
  if (!w) { w = { peers: new Map(), tasks: new Map() }; workspaces.set(key, w); }
  return w;
}

function makePeer(b) {
  return {
    id: randomUUID(),
    summary: b.summary || '', peer_alias: b.peer_alias || b.summary || '',
    group_names: normGroups(b.group_names || (b.group_name ? [b.group_name] : [])),
    cwd: b.cwd || '', git_root: b.git_root || '', git_branch: b.git_branch || '',
    machine: b.machine || '', kind: b.kind || '', pid: b.pid ?? null,
    capabilities: Array.isArray(b.capabilities) ? b.capabilities : [],
    created_at: now(), last_seen: now(), messages: [],
  };
}
function peerView(p) {
  const age = Math.floor((now() - p.last_seen) / 1000);
  return {
    id: p.id, peer_address: p.id, summary: p.summary,
    group_name: p.group_names[0] || '', group_names: p.group_names,
    cwd: p.cwd, git_branch: p.git_branch, machine: p.machine,
    status: (now() - p.last_seen) <= PEER_TTL_MS ? 'online' : 'stale',
    age_seconds: age, last_seen: new Date(p.last_seen).toISOString(),
  };
}
const sharesGroup = (a, b) => a.group_names.some(g => b.group_names.includes(g));

function prune() {
  const cutoff = now() - PEER_TTL_MS;
  for (const w of workspaces.values())
    for (const [id, p] of w.peers)
      if (p.last_seen < cutoff) { w.peers.delete(id); log(`pruned stale peer ${id} (${p.summary})`); }
}
const pruneTimer = setInterval(prune, PRUNE_INTERVAL_MS); pruneTimer.unref?.();

function send(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(s);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', c => d += c);
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

const server = createServer(async (req, res) => {
  try {
    if ((req.headers['authorization'] || '') !== `Bearer ${TOKEN}`) return send(res, 401, { error: 'unauthorized' });
    const w = ws(req.headers['x-workspace-id']);
    const parts = new URL(req.url, 'http://x').pathname.split('/').filter(Boolean);
    const m = req.method;
    const body = (m === 'POST' || m === 'PATCH') ? await readBody(req) : {};
    if (parts[0] !== 'v0') return send(res, 404, { error: 'not found' });

    // ---- /v0/peers ----
    if (parts[1] === 'peers') {
      if (m === 'POST' && parts[2] === 'register') {
        const p = makePeer(body); w.peers.set(p.id, p);
        log(`registered ${p.id} name=${p.summary} groups=[${p.group_names}]`);
        return send(res, 200, { peer_id: p.id });
      }
      if (m === 'GET' && parts.length === 2) {
        return send(res, 200, { peers: [...w.peers.values()].map(peerView) });
      }
      const id = parts[2];
      const p = id ? w.peers.get(id) : null;
      if (parts.length >= 3) {
        if (m === 'DELETE' && parts.length === 3) { if (p) w.peers.delete(id); return send(res, 200, {}); }
        if (!p) return send(res, 404, { error: 'peer not found' }); // → client re-registers
        if (m === 'PATCH' && parts.length === 3) {
          if (body.summary !== undefined) { p.summary = body.summary; p.peer_alias = body.peer_alias || body.summary; }
          if (body.group_names !== undefined) p.group_names = normGroups(body.group_names);
          p.last_seen = now();
          return send(res, 200, { group_names: p.group_names });
        }
        if (m === 'POST' && parts[3] === 'groups' && parts.length === 4) {
          const g = String(body.group_name || '').trim();
          if (g && !p.group_names.includes(g)) p.group_names.push(g);
          p.last_seen = now();
          return send(res, 200, { group_names: p.group_names });
        }
        if (m === 'DELETE' && parts[3] === 'groups' && parts.length === 5) {
          const g = decodeURIComponent(parts[4]);
          p.group_names = p.group_names.filter(x => x !== g);
          p.last_seen = now();
          return send(res, 200, { group_names: p.group_names });
        }
        if (m === 'GET' && parts[3] === 'messages') {
          p.last_seen = now();
          const msgs = p.messages; p.messages = [];
          return send(res, 200, { messages: msgs });
        }
        if (m === 'POST' && parts[3] === 'send') {
          const to_name = String(body.to_peer_name || '').trim();
          const group = String(body.group_name || '').trim();
          p.last_seen = now();
          const target = [...w.peers.values()].find(q =>
            q.id !== p.id && q.summary === to_name &&
            (group ? (q.group_names.includes(group) && p.group_names.includes(group)) : sharesGroup(p, q)));
          if (!target) return send(res, 404, { error: `no peer named "${to_name}" in a shared group` });
          const task_id = randomUUID();
          const chosenGroup = group || target.group_names.find(g => p.group_names.includes(g)) || '';
          target.messages.push({
            text: String(body.text || ''), task_id, from_id: p.id, sent_at: new Date().toISOString(),
            role_name: String(body.role_name || ''), skill_name: String(body.skill_name || ''), context_hash: String(body.context_hash || ''),
          });
          w.tasks.set(task_id, { task_id, from_id: p.id, to_peer_id: target.id, status: 'pending', created_at: now() });
          return send(res, 200, { to_peer_id: target.id, task_id, group_name: chosenGroup });
        }
        if (m === 'POST' && parts[3] === 'heartbeat') { p.last_seen = now(); return send(res, 200, {}); }
      }
    }
    // ---- /v0/tasks/:id/complete ----
    if (parts[1] === 'tasks' && parts[3] === 'complete' && m === 'POST') {
      const t = w.tasks.get(parts[2]);
      if (t) { t.status = String(body.status || 'completed'); t.summary = String(body.summary || ''); t.completed_at = now(); }
      return send(res, 200, {});
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    log(`handler error: ${e.stack || e}`);
    try { send(res, 500, { error: String(e.message || e) }); } catch { /* response already sent */ }
  }
});

// Resilience: a single bad request or stray rejection must not kill the broker.
process.on('uncaughtException', (e) => log(`uncaughtException (ignored): ${e.stack || e}`));
process.on('unhandledRejection', (e) => log(`unhandledRejection (ignored): ${e}`));
server.on('error', (e) => { log(`server error: ${e.message}`); process.exit(1); });
server.listen(PORT, () => log(`listening on :${PORT} (workspace=${DEFAULT_WORKSPACE}, peer TTL=${PEER_TTL_MS}ms)`));
