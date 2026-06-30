# cube-relay

무의존성·인메모리·**포터블** relay broker. 기존 `rulmo-relay` client plugin의 `/v0` REST 계약을 그대로 구현해 **드롭인 교체**된다. 죽으면 어디서든(다른 호스트·로컬) 한 줄로 다시 띄우면 되고, 피어는 자동 재등록한다.

## 왜
- **이식성**: 외부 의존성 0, 상태 영속 0 → 파일 하나 복사 + `node broker.mjs`가 곧 배포.
- **복원력**: 인메모리라 broker가 죽었다 떠도, 피어들이 heartbeat/poll에서 404 받고 **자동 재등록**. "죽음"이 거의 무사건.
- **드롭인**: client는 `RELAY_BASE_URL`(+토큰)만 바꾸면 그대로 동작.

## 실행
```bash
CUBE_RELAY_TOKEN=<shared-secret> node broker.mjs
# 옵션 env: PORT(기본 8787), CUBE_RELAY_WORKSPACE(기본 company-main), CUBE_RELAY_PEER_TTL_MS(기본 60000)
```

## Claude Code 연결 (peer plugin)
이 repo는 broker(`broker.mjs`)뿐 아니라 **Claude Code가 붙는 peer 플러그인**(`plugins/cube-relay/`)도 포함한다 — zero-dep MCP 서버 + launcher + skill.

설정:
```bash
# 1) 토큰 1회 등록 (또는 CUBE_RELAY_TOKEN env)
mkdir -p ~/.config/cube-relay && printf '%s' '<shared-secret>' > ~/.config/cube-relay/token && chmod 600 ~/.config/cube-relay/token

# 2) broker 위치 지정 (기본 http://127.0.0.1:8787)
export CUBE_RELAY_BASE_URL=http://<host>:8787
```
- 플러그인 로드: `.claude-plugin/marketplace.json`을 통해 Claude Code 플러그인으로 설치(또는 dev-channel로 로드).
- peer 이름/그룹: `CUBE_RELAY_PEER_NAME`(또는 `RELAY_PEER_NAME`) / `CUBE_RELAY_PEER_GROUPS`(또는 `RELAY_PEER_GROUPS`).
- env는 `CUBE_RELAY_*`를 우선하고 기존 `RELAY_*`/`RULMO_RELAY_*`도 호환 수용한다.

견고성: peer 서버는 init 직후 `tools/list_changed`를 한 번 쏴서 콜드스타트 시 툴 누락을 자동 복구하고, `uncaughtException`/`unhandledRejection`을 삼켜 프로세스가 죽지 않는다.

## /v0 계약 (client가 쓰는 엔드포인트)
| 메서드·경로 | 요청 | 응답 |
|---|---|---|
| `POST /v0/peers/register` | {summary, group_names, cwd, git_branch, machine, ...} | `{peer_id}` |
| `GET /v0/peers` | — | `{peers:[{id,summary,group_names,status,age_seconds,last_seen,...}]}` |
| `PATCH /v0/peers/:id` | {summary} 또는 {group_names} | `{group_names}` |
| `POST /v0/peers/:id/groups` | {group_name} | `{group_names}` |
| `DELETE /v0/peers/:id/groups/:g` | — | `{group_names}` |
| `DELETE /v0/peers/:id` | — | `{}` |
| `GET /v0/peers/:id/messages` | — | `{messages:[{text,task_id,from_id,sent_at,role_name,skill_name,context_hash}]}` (큐 비움) |
| `POST /v0/peers/:id/send` | {to_peer_name,text,group_name,role_name,skill_name,context_hash} | `{to_peer_id,task_id,group_name}` |
| `POST /v0/peers/:id/heartbeat` | — | `{}` (모르는 peer면 `404`) |
| `POST /v0/tasks/:task_id/complete` | {status,summary,artifacts} | `{}` |

- 인증: `Authorization: Bearer <CUBE_RELAY_TOKEN>` + `X-Workspace-Id`(상태 네임스페이스).
- peer는 `last_seen`이 TTL(기본 60s) 지나면 정리 → client가 404 받고 재등록(자가복원).

## 상태 모델
인메모리, `X-Workspace-Id`별 네임스페이스. 영속 없음 — broker 재시작 시 진행 중 미수신 메시지는 유실되나 피어는 재등록된다(라이브 코디네이션 버스에 허용 가능한 트레이드오프).

## 테스트
```bash
npm test    # = node test/contract.mjs (broker 띄워 /v0 전 과정 검증, zero-dep)
```

## 비목표
- 메시지 영속/재전송 보장 (라이브 버스 — 유실 허용).
- 멀티 노드 broker 클러스터 (단일 프로세스, 어디든 띄우는 게 전략).
