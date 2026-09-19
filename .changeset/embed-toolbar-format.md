---
'@bozonx/fastcat': patch
'@bozonx/fastcat-embed': patch
'@fastcat/web': patch
---

The embedded editor's toolbar is simpler. Export is one button with an "Advanced export settings…" menu that opens the export form in a dialog, instead of a quick button next to an Export view. The view switcher appears only when the host enabled more than one view, and the touch layout switches views from the same toolbar instead of a bottom bar. A badge shows the output resolution and frame rate and where they came from; when no video could set them (only images or audio), the user is asked once the media has loaded, and again before exporting. The properties panel shows the timeline instead of the session's workspace folder, which offered uploads and new documents the session would lose. The close button sits apart from the editing controls, and the layout switch is limited to builds with in-development features.
