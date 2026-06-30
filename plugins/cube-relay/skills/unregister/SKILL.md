---
name: unregister
description: cube-relay에서 빠지기 — 모든 그룹을 떠나 다른 피어에게 안 보이게 한다.
---

`change_group`를 빈 그룹("")으로 호출해 모든 그룹을 떠난다. (세션을 닫으면 peer는 broker에서 자동 정리되고, 안 닫아도 TTL 후 정리된다.)
