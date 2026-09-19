# @bozonx/fastcat-embed

## 0.7.3

### Patch Changes

- 2ed6cd4: Embedded exports and asset loading are more robust. The editor keeps an exported file for the host for up to ten minutes (`EMBED_EXPORT_ACK_TIMEOUT_MS`) instead of thirty seconds, so copying a large render inside `onExportDone` no longer races its deletion; `meta.mimeType` is read from the container; a host-started export that the form refuses (a taken or invalid filename) now answers with `export:error` instead of nothing. Filenames that merely contain two dots are accepted, and unknown `features` are ignored as documented instead of failing `init`. `cancelExport()` works for exports started from the editor's export panel, and a cancelled export reaches `onError` as `export-cancelled` (`export:error` carries `reason: 'cancelled'`) instead of `export-failed`. A download whose URL the host fails to refresh gives up after a minute instead of stalling the session, a failed download no longer leaves a truncated file behind, a server that does not report the size is read correctly, the session timeline can no longer be deleted, and files in an embedded session can no longer be renamed or moved — the host's draft names each clip's file by the path the session gave it.
- 07ea455: Keyboard shortcuts now work in the embedded editor. Shortcuts for views the host did not enable and for the application's settings dialogs are left to the page.
- cf4ab2f: The embedded editor's toolbar is simpler. Export is one button with an "Advanced export settings…" menu that opens the export form in a dialog, instead of a quick button next to an Export view. The view switcher appears only when the host enabled more than one view, and the touch layout switches views from the same toolbar instead of a bottom bar. A badge shows the output resolution and frame rate and where they came from; when no video could set them (only images or audio), the user is asked once the media has loaded, and again before exporting. The properties panel shows the timeline instead of the session's workspace folder, which offered uploads and new documents the session would lose. The close button sits apart from the editing controls, and the layout switch is limited to builds with in-development features.
- a44e1e2: The embedded editor no longer offers what an embedded session would lose or what belongs to the host: extra timelines, versions and notes, the workspace and remote library browsers, and the language, storage, integration, proxy, engine and backup settings. The export panel's button now delivers the render to the host instead of the session's own folder, the `locale` passed at start-up is applied instead of being overridden by the default, and file conversion from the file manager opens its dialog.
- 13c7a43: changes

## 0.7.2

### Patch Changes

- 0b3a758: fix release

## 0.7.1

### Patch Changes

- 84d515e: change

## 0.7.0

### Minor Changes

- fa0a9d3: New package `@bozonx/fastcat`: the prebuilt web editor for serving it from your own domain, with `@bozonx/fastcat/hosting` to compute its response headers and `HOSTING.md` describing the contract. `@bozonx/fastcat-embed` is now released in lockstep with it, so the SDK version jumps to match the editor's; the SDK itself is unchanged.

### Patch Changes

- 62f9e14: add npm package

## 0.2.2

### Patch Changes

- 988ffcc: version

## 0.2.1

### Patch Changes

- 273e99d: fix embed
- 3bae10b: Stop reporting a spurious `protocol-timeout` after every successful export. `export:ack` is the last message of an export — the editor answers it by releasing the rendered file and sends nothing back — so the SDK was timing out on a reply that does not exist, and hosts saw an error thirty seconds after each render. `exportAckTimeoutMs` is now ignored and deprecated.
- 273e99d: fix

## 0.2.0

### Minor Changes

- 79c1318: Add file id support

### Patch Changes

- f146af0: Separate asset storage identity from display filenames and report invalid initialization payloads.

## 0.1.0

### Minor Changes

- 28cdf50: Release
- 02a680a: Prepare the public FastCat Embed SDK for automated npm publishing under the `@bozonx` scope.

### Patch Changes

- b0f38a8: Remove native checks
