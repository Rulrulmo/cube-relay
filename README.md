# cube-relay

무의존성·인메모리·포터블 relay. Claude Code 세션(피어)들이 서로 A2A 메시지를 주고받게 해주는 경량 **broker** + **peer 플러그인**. 파일 하나로 어디서든 띄우고, 죽으면 다시 띄우면 된다.

## 1. 동작 방식

- **broker** (`broker.mjs`) — 무의존성 Node HTTP 서버. 피어 등록·그룹·메시지 큐·태스크를 **인메모리**로 관리. `X-Workspace-Id` 네임스페이스 + `Bearer` 토큰 인증.
- **peer 플러그인** (`plugins/cube-relay/`) — Claude Code MCP 서버. 세션을 broker에 피어로 등록하고, `send_to_peer_name`으로 다른 피어에 요청을 보내며, 받은 요청은 채널 메시지로 세션에 주입한다.
- **그룹** — 피어는 그룹에 속하고, 같은 그룹 피어끼리만 보이고 메시지한다.
- **자가복원** — 인메모리라 broker가 재시작돼도 피어가 heartbeat/poll에서 **자동 재등록**된다. crash 핸들러 내장 + 서비스로 띄우면 자동 재시작 → "broker 죽음"이 거의 무사건.
- **토큰** — broker·peer가 공유. `~/.config/cube-relay/token` 파일 또는 env(`CUBE_RELAY_TOKEN`).

## 2. broker 설치

토큰 설정(최초 1회):
```bash
mkdir -p ~/.config/cube-relay && printf '%s' 'YOUR_TOKEN' > ~/.config/cube-relay/token && chmod 600 ~/.config/cube-relay/token
```

실행 — 둘 중 하나:
```bash
# 직접 (토큰은 env 없으면 위 파일에서 읽음)
node broker.mjs

# macOS 서비스 (로그인 자동시작 + crash 자동재시작)
service/install-macos.sh        # 제거: service/uninstall-macos.sh
```
옵션 env: `PORT`(기본 8787), `CUBE_RELAY_WORKSPACE`(기본 company-main), `CUBE_RELAY_PEER_TTL_MS`(기본 60000).
서비스 상태/로그:
```bash
launchctl print gui/$(id -u)/work.rulrulmo.cube-relay | grep state
tail -f ~/Library/Logs/cube-relay.log
```

## 3. Claude Code에서 실행 (MCP 서버 등록)

peer를 **MCP 서버로 등록**한다 — `claude plugin install`이 아니라 `claude mcp add`다. relay의 채널 기능(받은 A2A를 세션에 푸시)은 이 등록을 `--dangerously-load-development-channels server:<name>`으로 로드해야 켜지기 때문. (`<DIR>` = 이 repo 클론 경로)
```bash
claude mcp add cube-relay-dev --scope user -e CUBE_RELAY_BASE_URL=http://127.0.0.1:8787 \
  -- <DIR>/plugins/cube-relay/bin/cube-relay-mcp
claude mcp get cube-relay-dev          # Status: ✔ Connected 확인
```
relay 채널을 로드하는 alias(`~/.zshrc`):
```bash
alias cr='command claude --dangerously-skip-permissions --dangerously-load-development-channels server:cube-relay-dev'
```
이제 `cr`로 띄운 세션에서:
- 피어 이름·그룹은 env로 지정: `RELAY_PEER_NAME=RC RELAY_PEER_GROUPS=mygroup cr`
- 세션 안에서 MCP 툴 사용: `relay_status`(상태), `list_peers`(같은 그룹 피어), `send_to_peer_name`(A2A 전송), `check_messages`, `complete_task`(태스크 완료), `join_group`/`change_group` 등.
- 원격/다른 기기의 broker면 등록 시 `CUBE_RELAY_BASE_URL`을 그 주소로.

---

테스트: `npm test`(broker 계약) · `node test/e2e.mjs`(peer↔broker A2A 왕복).
