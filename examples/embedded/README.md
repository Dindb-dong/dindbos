# Embed two independent desktops

Use the current SDK tarball from this repository while the new SDK is unpublished:

```sh
# From the repository root
npm run build:sdk
npm pack --pack-destination /tmp
cd examples/embedded
npm install /tmp/dindbos-0.2.0.tgz
npm run dev
```

After the matching SDK release is published, `npm install && npm run dev` also works from this example directory.

This example keeps a normally scrolling host page, host styles, and controls around two independently configured desktops. Each desktop uses its own named memory storage and appearance. The Workspace can be removed and restored without affecting the smaller desktop.

The notebook includes an optional nested desktop to demonstrate nearest-instance keyboard routing. In your site, give each desktop a container with an explicit height, choose a unique storage name, and import `dindbos/styles.css` once.

The `?qa=1` query enables instrumentation used by the repository's repeatable embedding regression. It is disabled during ordinary use.
