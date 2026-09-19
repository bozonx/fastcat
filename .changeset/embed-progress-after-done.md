---
'@bozonx/fastcat': patch
'@fastcat/web': patch
---

An embedded export no longer reports progress after `export:done`. The export form resets its phase once the file has been handed over, and that reset reached the host as `export:progress` at 100% — a host that shows progress took it for a new export and kept its overlay up for good.
