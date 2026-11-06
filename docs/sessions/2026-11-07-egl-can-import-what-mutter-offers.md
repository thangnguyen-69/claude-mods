# The GPU was never the problem: EGL can import exactly what Mutter offers

**Date:** 2026-11-07 · **Versions:** `vr-quest` 0.6.2 → 0.6.3

## The question

Immersed refuses to offer `SPA_DATA_DmaBuf` here (`dataType: 6` = `MemPtr|MemFd`, not `14`), so Mutter
follows its own rule and hands over `MemFd` buffers. Earlier notes called that "structural"; three
attempts to explain it were retracted in 0.6.1. What remained was the question of *where* the refusal
happens — and the suspicion had drifted toward the GPU or Mesa, since this is an AMD 780M.

## The probe

`EGL_LOG_LEVEL=debug` on a live, connected session produced the useful half of the answer but not the
refusal: EGL initialises on **radeonsi** (driver `amdgpu`, pci `1002:15bf`), so no llvmpipe fallback.
Immersed logs nothing about declining DMA-BUF.

So the capability was measured directly — open `/dev/dri/renderD128` with GBM, initialise EGL, and ask
it what it can import (`vr-dmabuf`, shipped with this change):

```
EGL 1.5 initialised on radeonsi
EGL_EXT_image_dma_buf_import              YES
EGL_EXT_image_dma_buf_import_modifiers    YES
EGL_MESA_image_dma_buf_export             YES
eglQueryDmaBufFormatsEXT -> 64 formats
ARGB8888/BGRA modifiers: 0x020000001046bb04, 0x0200000010467b04, 0x0200000010437b04,
                         0x0200000010401b04, 0x0200000000000a04, 0x0 (LINEAR)
```

Mutter advertises `alt1 = 0x20000001046bb04`. That is **the first modifier this EGL lists**. The
format Mutter offers is importable here, with the exact modifier value, on the real driver.

## What that eliminates

| Candidate | Verdict |
|---|---|
| GPU / driver / Mesa | **excluded** — EGL lists the exact modifier Mutter offers |
| Compositor | excluded — Mutter 48 buffer logic is byte-identical to 46's |
| PipeWire version gates | excluded — 3.24 / 3.33 / 3.40, all cleared by 1.0.5 |
| Patched binary | excluded — `sha256sum` matches the pristine download |
| Software rendering | excluded — EGL runs on radeonsi, not llvmpipe |

What is left is Immersed's own decision during `StartScreenCastStream`: it builds the consumer
`Buffers` pod with `dataType: 6` when it could emit `14`. Nothing outside the app constrains it.

## Two traps worth recording

**`No DRI config supports native format PIPE_FORMAT_*_UNORM` is a red herring.** Mesa prints it while
filtering candidate formats during init, and initialisation then succeeds on radeonsi. It reads like a
driver failure and is not one.

**A probe at `Screen count is 0` measures nothing.** The first debug relaunch had no headset connected,
so EGL never initialised and the log contained zero EGL lines — while the post-run fd check showed
0 dmabuf / 0 memfd, which is meaningless with no streams. The same restart *with* a connected headset
produced the real output.

## Also worth noting about the test itself

My first two attempts at this probe were wrong in the same way I keep warning about: `ctypes` signatures
written from memory returned `EGL_BAD_PARAMETER` (`0x300c`) and then an argument-type error. The spec
order is `eglQueryDmaBufFormatsEXT(dpy, max_formats, formats, num_formats)` and
`eglQueryDmaBufModifiersEXT(dpy, format, max_modifiers, modifiers, external_only, num_modifiers)`. It
was only correct after reading the signatures instead of recalling them — worth stating because
"`EGL_BAD_PARAMETER` from a hand-written probe" is not evidence about the driver.

## Next step

Disassembly of `StartScreenCastStream` around the `Buffers` pod construction: find what makes it choose
`6` over `14`. Contained, and the only thing left that can explain a per-host difference with an
identical build.
