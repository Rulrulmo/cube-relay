#!/usr/bin/env node
// Zero-dependency contract test: spins up broker.mjs and exercises the /v0 surface
// the rulmo-relay client depends on. Run: node test/contract.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BROKER = join(__dirname, '..', 'broker.mjs');
const PORT = 8799;
const TOKEN = 'testtok';
const BASE = `http://127.0.0.1:${PORT}`;
const WS = 'test-ws';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.error(`  ✗ ${msg}`); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function api(method, path, body, token = TOKEN) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'X-Workspace-Id': WS, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

const child = spawn('node', [BROKER], { env: { ...process.env, PORT: String(PORT), CUBE_RELAY_TOKEN: TOKEN }, stdio: ['ignore', 'inherit', 'inherit'] });

async function main() {
  // wait for listen
  for (let i = 0; i < 50; i++) { try { const r = await api('GET', '/v0/peers'); if (r.status === 200) break; } catch {} await sleep(100); }

  // auth
  ok((await api('GET', '/v0/peers', null, 'wrong')).status === 401, 'rejects bad token (401)');

  // register two peers in same group
  const rc = await api('POST', '/v0/peers/register', { summary: 'RC', group_names: ['g1'], cwd: '/rc' });
  const rag = await api('POST', '/v0/peers/register', { summary: 'RAG', group_names: ['g1'], cwd: '/rag' });
  ok(rc.status === 200 && rc.body.peer_id, 'register RC → peer_id');
  ok(rag.status === 200 && rag.body.peer_id, 'register RAG → peer_id');
  const RC = rc.body.peer_id, RAG = rag.body.peer_id;

  // list_peers
  const list = await api('GET', '/v0/peers');
  ok(list.body.peers.length === 2, 'list_peers → 2 peers');
  const ragView = list.body.peers.find(p => p.summary === 'RAG');
  ok(ragView && ragView.group_names.includes('g1') && ragView.status === 'online', 'peer view has group + online status');

  // send RC → RAG
  const sent = await api('POST', `/v0/peers/${RC}/send`, { to_peer_name: 'RAG', text: 'hello', group_name: 'g1', skill_name: 'planner-round' });
  ok(sent.status === 200 && sent.body.to_peer_id === RAG && sent.body.task_id, 'send_to_peer_name → to_peer_id + task_id');
  const TASK = sent.body.task_id;

  // RAG polls messages
  const msgs = await api('GET', `/v0/peers/${RAG}/messages`);
  ok(msgs.body.messages.length === 1, 'RAG receives 1 message');
  const msg = msgs.body.messages[0];
  ok(msg.text === 'hello' && msg.task_id === TASK && msg.from_id === RC && msg.skill_name === 'planner-round', 'message carries text/task/from/skill');
  // queue drained
  ok((await api('GET', `/v0/peers/${RAG}/messages`)).body.messages.length === 0, 'message queue drained after poll');

  // complete task
  ok((await api('POST', `/v0/tasks/${TASK}/complete`, { status: 'completed', summary: 'done' })).status === 200, 'complete_task → 200');

  // join/leave group
  ok((await api('POST', `/v0/peers/${RAG}/groups`, { group_name: 'g2' })).body.group_names.includes('g2'), 'join_group adds g2');
  ok(!(await api('DELETE', `/v0/peers/${RAG}/groups/g2`)).body.group_names.includes('g2'), 'leave_group removes g2');

  // change_group via PATCH
  ok((await api('PATCH', `/v0/peers/${RAG}`, { group_names: ['g9'] })).body.group_names.join() === 'g9', 'PATCH group_names replaces groups');

  // heartbeat
  ok((await api('POST', `/v0/peers/${RC}/heartbeat`)).status === 200, 'heartbeat known peer → 200');
  ok((await api('POST', `/v0/peers/does-not-exist/heartbeat`)).status === 404, 'heartbeat unknown peer → 404 (triggers re-register)');

  // send to unknown name → 404
  ok((await api('POST', `/v0/peers/${RC}/send`, { to_peer_name: 'NOPE' })).status === 404, 'send to unknown name → 404');

  // unregister
  ok((await api('DELETE', `/v0/peers/${RC}`)).status === 200, 'unregister → 200');
  ok((await api('GET', '/v0/peers')).body.peers.find(p => p.id === RC) === undefined, 'unregistered peer gone from list');
}

main()
  .catch(e => { console.error('test crashed:', e); fail++; })
  .finally(() => {
    child.kill('SIGTERM');
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
