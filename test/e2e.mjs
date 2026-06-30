#!/usr/bin/env node
// End-to-end: real broker + two real peer.mjs MCP servers driven over stdio JSON-RPC
// exactly like Claude Code does. Validates registration, list_peers, and A2A round-trip
// (RC send_to_peer_name → RAG receives a notifications/claude/channel push).
// Run: node test/e2e.mjs
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BROKER = join(ROOT, 'broker.mjs');
const PEER = join(ROOT, 'plugins', 'cube-relay', 'server', 'peer.mjs');
const PORT = 8788, TOKEN = 'e2etok', BASE = `http://127.0.0.1:${PORT}`, GROUP = 'g1';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.error(`  ✗ ${m}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const procs = [];
function startBroker() {
  const p = spawn('node', [BROKER], { env: { ...process.env, PORT: String(PORT), CUBE_RELAY_TOKEN: TOKEN }, stdio: ['ignore', 'inherit', 'inherit'] });
  procs.push(p); return p;
}

// A peer driver: spawns peer.mjs, speaks JSON-RPC over stdio, collects responses + notifications.
function startPeer(name) {
  const p = spawn('node', [PEER], { env: {
    ...process.env, CUBE_RELAY_BASE_URL: BASE, CUBE_RELAY_TOKEN: TOKEN,
    RELAY_PEER_NAME: name, RELAY_PEER_GROUPS: GROUP, RELAY_WORKDIR: ROOT,
  }, stdio: ['pipe', 'pipe', 'inherit'] });
  procs.push(p);
  const pending = new Map(); const notifications = []; let id = 0;
  readline.createInterface({ input: p.stdout }).on('line', (line) => {
    let msg; try { msg = JSON.parse(line); } catch { return; }
    if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) notifications.push(msg);
  });
  const rpc = (method, params) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n'); });
  const note = (method, params) => p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const call = async (toolName, args = {}) => { const r = await rpc('tools/call', { name: toolName, arguments: args }); return r.result?.content?.[0]?.text ?? ''; };
  return { name, rpc, note, call, notifications };
}

async function waitRegistered(peer, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const txt = await peer.call('relay_status');
    if (JSON.parse(txt).registration_state === 'registered') return true;
    await sleep(100);
  }
  return false;
}

async function main() {
  startBroker();
  await sleep(400);

  const rc = startPeer('RC');
  const rag = startPeer('RAG');

  // MCP handshake for both (initialize → initialized → tools/list)
  for (const peer of [rc, rag]) {
    const init = await peer.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} });
    ok(init.result?.serverInfo?.name === 'cube-relay', `${peer.name}: initialize → serverInfo cube-relay`);
    peer.note('notifications/initialized', {});
    const tools = await peer.rpc('tools/list', {});
    ok(Array.isArray(tools.result?.tools) && tools.result.tools.length >= 12, `${peer.name}: tools/list → ${tools.result?.tools?.length} tools`);
  }

  // both register against the broker (auto via startRegistration)
  ok(await waitRegistered(rc), 'RC registers with broker');
  ok(await waitRegistered(rag), 'RAG registers with broker');

  // list_peers: RC should see RAG in g1
  const peersTxt = await rc.call('list_peers');
  const peers = JSON.parse(peersTxt).peers || [];
  ok(peers.some(p => p.name === 'RAG' && p.group_names.includes(GROUP)), 'RC list_peers sees RAG in g1');

  // A2A: RC → RAG
  const before = rag.notifications.length;
  const sendTxt = await rc.call('send_to_peer_name', { peer_name: 'RAG', message: 'ping-e2e', skill_name: 'planner-round' });
  ok(/Sent to RAG/.test(sendTxt), `RC send_to_peer_name → "${sendTxt.slice(0, 40)}..."`);

  // RAG should receive a channel push within a couple poll intervals
  let channelMsg = null;
  for (let i = 0; i < 40; i++) {
    channelMsg = rag.notifications.slice(before).find(n => n.method === 'notifications/claude/channel');
    if (channelMsg) break;
    await sleep(100);
  }
  ok(!!channelMsg, 'RAG receives a claude/channel notification');
  ok(channelMsg?.params?.content === 'ping-e2e', `channel content == "ping-e2e" (got "${channelMsg?.params?.content}")`);
  ok(channelMsg?.params?.meta?.source === 'cube-relay', 'channel meta.source == cube-relay');
  ok(channelMsg?.params?.meta?.kind === 'request', 'incoming task meta.kind == request');
  ok(channelMsg?.params?.meta?.skill_name === 'planner-round', 'channel meta carries skill_name');
  ok(!!channelMsg?.params?.meta?.task_id, 'channel meta carries task_id');

  // B: RAG completes the task → RC should get a peer-reply (result auto-delivered)
  const taskId = channelMsg.params.meta.task_id;
  const beforeRC = rc.notifications.length;
  await rag.call('complete_task', { task_id: taskId, status: 'completed', summary: 'done-e2e' });
  let reply = null;
  for (let i = 0; i < 40; i++) {
    reply = rc.notifications.slice(beforeRC).find(n => n.method === 'notifications/claude/channel' && n.params?.meta?.kind === 'peer-reply');
    if (reply) break;
    await sleep(100);
  }
  ok(!!reply, 'RC receives a peer-reply after RAG complete_task');
  ok(reply?.params?.content === 'done-e2e', `peer-reply content == "done-e2e" (got "${reply?.params?.content}")`);
  ok(reply?.params?.meta?.task_id === taskId, 'peer-reply correlates to original task_id');
}

main()
  .catch(e => { console.error('e2e crashed:', e); fail++; })
  .finally(async () => {
    for (const p of procs) { try { p.kill('SIGTERM'); } catch {} }
    await sleep(200);
    console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  });
