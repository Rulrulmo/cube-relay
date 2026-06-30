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

## client 연결
rulmo-relay client(`cr`)를 cube-relay로 향하게:
```bash
RELAY_BASE_URL=http://<host>:8787 RULMO_RELAY_TOKEN=<shared-secret> cr ...
```
peer 이름/그룹은 기존대로 `RELAY_PEER_NAME` / `RELAY_PEER_GROUPS`로.

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
