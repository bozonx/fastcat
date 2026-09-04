# @bozonx/fastcat-embed

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
