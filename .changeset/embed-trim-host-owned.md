---
'@bozonx/fastcat': patch
'@bozonx/fastcat-embed': patch
'@fastcat/web': patch
---

The embedded editor no longer offers what an embedded session would lose or what belongs to the host: extra timelines, versions and notes, the workspace and remote library browsers, and the language, storage, integration, proxy, engine and backup settings. The export panel's button now delivers the render to the host instead of the session's own folder, the `locale` passed at start-up is applied instead of being overridden by the default, and file conversion from the file manager opens its dialog.
