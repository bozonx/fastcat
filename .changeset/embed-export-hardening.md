---
'@bozonx/fastcat': patch
'@bozonx/fastcat-embed': patch
'@fastcat/web': patch
---

Embedded exports and asset loading are more robust. The editor keeps an exported file for the host for up to ten minutes (`EMBED_EXPORT_ACK_TIMEOUT_MS`) instead of thirty seconds, so copying a large render inside `onExportDone` no longer races its deletion; `meta.mimeType` is read from the container; a host-started export that the form refuses (a taken or invalid filename) now answers with `export:error` instead of nothing. Filenames that merely contain two dots are accepted, and unknown `features` are ignored as documented instead of failing `init`. `cancelExport()` works for exports started from the editor's export panel, and a cancelled export reaches `onError` as `export-cancelled` (`export:error` carries `reason: 'cancelled'`) instead of `export-failed`. A download whose URL the host fails to refresh gives up after a minute instead of stalling the session, a failed download no longer leaves a truncated file behind, a server that does not report the size is read correctly, the session timeline can no longer be deleted, and files in an embedded session can no longer be renamed or moved — the host's draft names each clip's file by the path the session gave it.
