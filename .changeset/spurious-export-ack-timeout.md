---
'@bozonx/fastcat-embed': patch
---

Stop reporting a spurious `protocol-timeout` after every successful export. `export:ack` is the last message of an export — the editor answers it by releasing the rendered file and sends nothing back — so the SDK was timing out on a reply that does not exist, and hosts saw an error thirty seconds after each render. `exportAckTimeoutMs` is now ignored and deprecated.
