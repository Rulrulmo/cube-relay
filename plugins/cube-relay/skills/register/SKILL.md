---
name: register
description: cube-relay 피어로 등록 — 이 세션의 이름(alias)과 그룹을 설정한다. 예 "/register RC mygroup".
---

입력: $ARGUMENTS = `<alias> [group]`

1. 첫 단어(alias)로 `set_peer_name` 툴 호출 (예: RC, RAG).
2. 둘째 단어(group)가 있으면 `change_group` 툴로 그 그룹에 참여.
3. `relay_status`로 확인해 peer_id · 이름 · 그룹을 한 줄로 보고.

(같은 그룹에 속한 피어끼리만 서로 보이고 메시지할 수 있다.)
