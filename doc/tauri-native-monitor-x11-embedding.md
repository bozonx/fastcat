# Tauri native monitor X11 embedding approach

This note documents the retired Linux approach that embedded the native monitor
inside the main Tauri window.

## Goal

The native monitor was implemented as a separate `winit` window rendered by the
Rust compositor. To make it look like part of the editor panel, the Linux build
forced both GTK/WebKit and `winit` to use X11 and then reparented the monitor
window into the main Tauri window.

## How it was wired

The application set Linux windowing variables before Tauri initialized:

```rust
std::env::set_var("GDK_BACKEND", "x11");
std::env::set_var("WINIT_UNIX_BACKEND", "x11");
```

The monitor event loop also forced `winit` to build an X11 event loop:

```rust
EventLoopBuilderExtX11::with_x11(&mut builder);
```

The frontend measured the monitor panel DOM rectangle and sent physical-pixel
coordinates through `monitor_set_viewport`. The Rust command read the raw handle
of the main Tauri window and passed it to the monitor thread.

On Linux, the monitor window used `winit::platform::x11::WindowAttributesExtX11`:

```rust
window_attrs = window_attrs
    .with_embed_parent_window(parent_xid)
    .with_override_redirect(true);
```

`with_embed_parent_window` performed the X11 reparent operation, so the monitor
stopped being a normal toplevel window and was clipped/moved with the main Tauri
window. `with_parent_window` was not enough on X11 because it did not perform
the reparenting needed for this UI.

## Frontend mode split

The frontend exposed two monitor output modes:

- `embedded`: native X11 child window inside the monitor panel.
- `canvas`: offscreen native render streamed as RGBA frames into an HTML
  `<canvas>` through a Tauri `Channel`.

The embedded mode had lower copy overhead, but HTML/SVG overlays could not be
drawn above the native child window reliably. The canvas mode supported editor
overlays because the preview was regular web content.

## Problems

The approach was Linux/X11-specific and worked against the normal Tauri desktop
stack. On Wayland sessions it required forcing X11/XWayland for the whole app,
which is not the recommended Tauri behavior and could interact poorly with
desktop integration, scaling, focus, and compositor behavior.

The old embedding also created a tighter coupling between the main webview
window and the monitor event loop: the monitor needed raw native parent handles,
platform-specific window attributes, and per-platform failure handling.

## Replacement

The current implementation lets Tauri and the platform choose the normal window
backend. The editor panel uses the native compositor in canvas-stream mode. A
standalone native monitor can be opened explicitly from the monitor context menu
with `Open native monitor`.
