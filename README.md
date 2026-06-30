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

## 3. Claude Code에서 실행

**① 플러그인 설치** (clone 불필요):
```bash
claude plugin marketplace add Rulrulmo/cube-relay
claude plugin install cube-relay@cube-relay
```

**② 실행** — 플러그인 서버를 relay 채널로 로드하며 Claude Code를 띄운다:
```bash
claude --dangerously-skip-permissions --dangerously-load-development-channels server:plugin:cube-relay:cube-relay
```
> 채널 기능(받은 A2A를 세션에 푸시)은 `--dangerously-load-development-channels`가 필요하다. 원격 broker면 앞에 `CUBE_RELAY_BASE_URL=http://<host>:8787`. (자주 쓰면 alias로 묶어 쓰면 된다.)

**③ 토큰** (broker와 동일, 없으면):
```bash
mkdir -p ~/.config/cube-relay && printf '%s' 'YOUR_TOKEN' > ~/.config/cube-relay/token && chmod 600 ~/.config/cube-relay/token
```

**④ 사용** — 위 명령으로 띄운 세션에서 슬래시 커맨드:
```
/register RC mygroup     # 이름 + 그룹 등록
/peers                   # 같은 그룹 피어 목록
/groups                  # 내 그룹 ( "/groups other" 로 변경 )
"worker에게 'API 리뷰해줘' 보내줘"   # 자연어 → send_to_peer_name
/unregister              # 그룹에서 빠지기
```
스크립트 자동 부팅에선 슬래시 대신 env로 이름·그룹 지정: 실행 명령 앞에 `RELAY_PEER_NAME=RC RELAY_PEER_GROUPS=g`.

---

테스트: `npm test`(broker 계약) · `node test/e2e.mjs`(peer↔broker A2A 왕복).
