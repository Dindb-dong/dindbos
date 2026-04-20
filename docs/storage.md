# DindbOS Storage

DindbOS uses browser storage as a layered disk model.

```text
/home/guest        internal browser disk
/opt               installed packages
/var/lib/dindbos   package and runtime records
/var/cache         future package and asset cache
/mnt/<name>        user-selected local folders
```

Current implementation:

- VFS metadata is stored through `PersistentStorage`.
- OPFS is preferred when available. It stores the VFS tree as a manifest and stores each file's content as a separate OPFS record.
- IndexedDB, localStorage, and memory remain fallbacks for snapshot storage.
- `storage` reports backend, saved bytes, and browser quota estimates when available.
- `storage persist` requests persistent browser storage.
- `mount-local [name]` uses File System Access API to mount a user-selected folder under `/mnt`.
- `mount-local --list` reports persisted and runtime local mounts.
- `mount-local --restore` requests permission again and reconnects persisted local mounts.
- `mount-local --forget <path>` removes a persisted local mount handle.
- `umount [--forget] <path>` detaches a local folder, optionally removing its persisted handle.
- Terminal file operations can copy text files between internal DindbOS paths and local mounts.

Example:

```text
mount-local mydisk
ls /mnt/mydisk
echo hello > /mnt/mydisk/hello.txt
cp /mnt/mydisk/hello.txt ~/Documents/hello.txt
cp ~/Documents/todo.md /mnt/mydisk/todo.md
mount-local --list
umount /mnt/mydisk
mount-local --restore
umount --forget /mnt/mydisk
```

Local folder mounts are intentionally opt-in. DindbOS cannot and should not silently mount the user's whole computer. The browser requires a user gesture and folder picker, and the mount only covers the selected folder. In Chromium-based browsers, accepted directory handles are stored in IndexedDB so DindbOS can reconnect them on the next boot if permission is still granted. If the browser returns `prompt`, `mount-local --restore` asks for permission again.

Planned storage stack:

- OPFS for internal file contents and future inode metadata records
- IndexedDB for package records, structured handles, and browser objects that OPFS cannot store
- Cache API for npm tarballs, registry responses, documents, and image caches
- File System Access API for external local folder mounts
- Storage Buckets where available for `/tmp`, `/var/cache`, and durable app data separation

Known limits:

- binary-safe copy/export is pending
- inode metadata is still manifest-based; only file contents are split into per-file OPFS records
- every save currently serializes the tree; dirty-file-only writes are pending
- directory copy between OPFS and local mounts is pending
- browser support is strongest in Chromium-based browsers
