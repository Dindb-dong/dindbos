# DindbOS Storage

DindbOS uses browser storage as a layered disk model.

```text
/home/guest        internal browser disk
/opt               installed packages
/var/lib/dindbos   package and runtime records
/var/cache         package and document cache policy area
/tmp               temporary scratch policy area
/mnt/<name>        user-selected local folders
```

Current implementation:

- VFS metadata is stored through `PersistentStorage`.
- OPFS is preferred when available. It stores a tiny root manifest, separate inode metadata records, and content-addressed file records.
- Saves compare record hashes and only rewrite dirty inode/content records.
- Filesystem changes are debounced and coalesced so bursts of writes produce one persisted snapshot.
- VFS exposes binary-safe byte read/write APIs while keeping text APIs compatible.
- In-memory binary file nodes use native `Uint8Array`; base64 is only used at persistence/export boundaries.
- Files.app supports browser file import, DindbOS archive export/import, and drag and drop upload.
- AppSandbox file writes and Files.app imports reserve estimated bytes before VFS mutation; quota denial preserves existing files and stops archive staging before it starts.
- Files.app shows local mount permission state, reconnect/sync/forget actions, and copy/move/import/export progress.
- IndexedDB, localStorage, and memory remain fallbacks for snapshot storage.
- `storage` reports backend, saved bytes, and browser quota estimates when available.
- `storage persist` requests persistent browser storage.
- `storage flush` forces pending filesystem writes to commit immediately.
- Settings.app exposes storage quota, pending write state, manual flush, and local mount management.
- When filesystem writes are pending or in flight, DindbOS attempts a best-effort flush during `beforeunload`, `pagehide`, and hidden-tab visibility changes. `beforeunload` also asks the browser to show its native leave-page prompt while pending writes exist.
- `mount-local [name]` uses File System Access API to mount a user-selected folder under `/mnt`.
- `mount-local --list` reports persisted and runtime local mounts.
- `mount-local --restore` requests permission again and reconnects persisted local mounts.
- `mount-local --forget <path>` removes a persisted local mount handle.
- `umount [--forget] <path>` detaches a local folder, optionally removing its persisted handle.
- Terminal file operations can copy text files between internal DindbOS paths and local mounts.
- Local mount writes compare the target file against the last synced metadata before writing. If the external file changed on disk after the last sync, DindbOS blocks the write, preserves the external file, and reports a `sync-conflict` operation through local mount status.
- Local mount directory copy conflicts are explicit: low-level runtime calls default to `error`, while callers can choose `replace`, `merge`, `skip`, `rename`, or `prompt` with a conflict resolver. `merge` is non-destructive and preserves existing conflicting children; `replace` removes the target tree first.
- Files.app copy, move, import, and export traversals use cooperative scheduling with progress and cancellation checks so large trees are chunked instead of running as one uninterrupted browser task.
- Viewer.app caches document and image preview bytes through the runtime Cache API store with memory fallback, using path, MIME type, size, and modified time in the cache key.
- `os.diskPolicyAreas()`, `os.diskPolicyForPath(path)`, and `df` expose policy areas for `/home`, `/opt`, `/var`, `/tmp`, `/mnt`, and `/var/cache`.
- `os.storageBucketPolicy()` reports whether `navigator.storageBuckets` exists and records the current decision. Today DindbOS keeps the proven OPFS/IndexedDB/Cache split, while `/tmp`, `/var/cache`, and durable areas are separated by disk policy and reported bucket intent.

Smoke test:

```text
npm run smoke:storage
npm run smoke:persistent-storage
npm run smoke:files
npm run smoke:local-mounts
npm run smoke:viewer
```

The storage smoke test writes text and binary files, verifies copied bytes, serializes a binary content record, reloads through a VFS snapshot, and fails if any byte changes. The persistent storage smoke test verifies localStorage-style snapshot fallback and OPFS write-failure fallback with binary bytes. The Files.app smoke test exports a directory archive, imports it again, verifies nested binary bytes, and proves scheduled copy/import yields during traversal. The local mounts smoke test verifies that a permission-denied directory handle fails before creating a runtime mount or VFS mount node, that directory copy policies preserve or replace target trees as requested, that same-folder local mount rename refuses browser copy-delete without a file helper companion, that a configured `dindbos-file-helper-v1` rename hook changes the external entry, and that disk-side changes trigger a sync conflict instead of being overwritten. The Viewer.app smoke test verifies preview cache writes and hits for image/document bytes.

Example:

```text
mount-local mydisk
ls /mnt/mydisk
echo hello > /mnt/mydisk/hello.txt
cp /mnt/mydisk/hello.txt ~/Documents/hello.txt
cp ~/Documents/todo.md /mnt/mydisk/todo.md
mount-local --list
mount-local --helper
umount /mnt/mydisk
mount-local --restore
umount --forget /mnt/mydisk
```

Local folder mounts are intentionally opt-in. DindbOS cannot and should not silently mount the user's whole computer. The browser requires a user gesture and folder picker, and the mount only covers the selected folder. In Chromium-based browsers, accepted directory handles are stored in IndexedDB so DindbOS can reconnect them on the next boot if permission is still granted. If the browser returns `prompt`, `mount-local --restore` asks for permission again.

Local mount rename is deliberately native-helper gated. Browser File System Access handles do not expose a stable host path or an OS-level rename primitive, so DindbOS does not fake rename with copy-delete for same-folder local mount renames. If a deployment configures a separate `dindbos-file-helper-v1` companion with `file.rename`, `os.localMounts.move()` routes the rename through that helper and then resyncs the mounted directory. Without that helper, the operation fails with a specific message and leaves the source entry untouched. This file helper boundary is separate from `browserd`.

Planned storage stack:

- OPFS for internal file contents and inode metadata records
- IndexedDB for package records, structured handles, and browser objects that OPFS cannot store
- Cache API for npm tarballs, registry responses, documents, and image caches
- Current Cache API coverage: npm metadata/tarballs, remote package manifests/files, and Viewer.app document/image preview bytes, with memory fallback
- File System Access API for external local folder mounts
- Storage Buckets can be adopted later for physical separation of `/tmp`, `/var/cache`, and durable app data after browser support, quota, migration, and eviction behavior are verified. Current runtime status is available through `os.storageBucketPolicy()`.

Known limits:

- Blob/File inputs are normalized into in-memory `Uint8Array` nodes before persistence
- persistence still walks the in-memory tree to compute record hashes
- page unload flushing is best-effort because browsers may stop asynchronous storage work during shutdown; DindbOS prompts on `beforeunload` only when pending writes are visible to the runtime
- directory copy between internal VFS paths and local mounts works, and large Files.app tree traversals yield cooperatively while still running inside the browser runtime
- same-folder local mount rename requires a separate file helper companion; the browser runtime refuses copy-delete rename when that helper is absent
- browser support is strongest in Chromium-based browsers
