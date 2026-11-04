# NFC files, terminal utilities, Dock performance and SDK customization

Plan supplied by GPT-6 Astra at high reasoning effort before implementation, based on `61ee980`. Implementation ran in independent filesystem, shell and Dock lanes, with SDK and integration work coordinated separately.

## Plan and acceptance

| Lane | Smallest complete change | Acceptance |
| --- | --- | --- |
| Filesystem | NFC names and paths; compatible legacy NFD reads; preserve ambiguous siblings; map canonical mount paths to real handle names | CRUD, atomic writes, links, reload, unchanged bytes, collision refusal and sandbox boundaries |
| Terminal | `head`, `tail`, `wc`, `sort`, `uniq`, `basename`, `dirname`; reuse existing file access and pipelines | Sync/async input, Unicode, permissions, redirection, usage status and command discovery |
| Dock | Batch layout reads/writes; coalesce map rebuilds; reduce per-instance rendering budget under sustained pressure | Latest geometry, retained optical effect, accessibility, instance isolation and complete cleanup |
| SDK | Keep existing wallpaper/theme/slot APIs; expose hardcoded Dock geometry and material through CSS variables | Custom/default independent desktops, light/dark, refraction/frosted/off, narrow host and forced colors |

Existing persisted collisions must never throw during VFS construction, because the storage-load recovery path can fall back to a seed filesystem. Preserve both nodes and reject ambiguous operations instead. Caller-provided path-map seed collisions fail explicitly before any overwrite.

No new dependencies, shell parser redesign, new theme system or default visual redesign were needed.

## Verification

- All entries in the `smoke` script passed, including new NFC and glass scheduling checks. The run was resumed with the existing system Chrome after the absent bundled Playwright browser was detected; no browser download was needed.
- `typecheck`, `build`, `smoke:sdk-build` and `smoke:sdk-pack` passed. Packaging was installed into an isolated temporary consumer, built and exercised, then cleaned by the existing test.
- `smoke:host-apps`, `smoke:host-lifecycle`, `smoke:desktop-ui`, `smoke:shell-ui`, `smoke:shell-browser`, `smoke:dock-browser`, and `smoke:customization-browser` passed.
- Isolated and integrated liquid-glass browser checks passed, including real backdrop pixel displacement, live background changes, light/dark and forced colors.
- Same-Chrome 24-frame resize comparison: baseline 22 map rebuilds, updated 2 (about 91% fewer). RAF p50 remained 16.7 ms; p95 was 16.8 ms baseline and 17.3 ms updated. No FPS improvement is claimed.
- Deterministic scheduling tests and CPU-throttled deliberately slow encoding confirmed budget reduction and independent frosted fallback. Browser evidence is retained under ignored `internal/docs/qa/` directories.

## Limits

External disk filename representation remains under the operating system's control; the runtime uses NFC virtual paths while accessing the actual external names. Native folder-picker interaction and real low-end GPU behavior were not tested. Safari/Firefox receive the existing frosted fallback; optical parity on those browsers is not claimed. New shell tools implement only the documented options and a single file operand.

Implementation is committed locally; pushing, merging and deployment are outside this request.
