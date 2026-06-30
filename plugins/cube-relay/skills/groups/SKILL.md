---
name: groups
description: cube-relay 그룹 조회/변경. "/groups" 조회, "/groups <name>" 그 그룹으로 변경.
---

입력: $ARGUMENTS (그룹명, 없으면 조회)

- 비어 있으면 `list_groups`로 현재 속한 그룹을 보고.
- 값이 있으면 `change_group`(group=$ARGUMENTS)로 그 그룹으로 변경(기존 그룹 대체). 여러 그룹에 동시 가입은 `join_group`.
