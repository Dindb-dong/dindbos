# React apps

Import React adapters from `dindbos/react` and styles once from `dindbos/styles.css`. The desktop's host needs an explicit height, whether pixels or a parent with a defined height.

```jsx
import React, { useContext, useState } from "react";
import { DindbOSDesktop, DindbOSApp, useDindbOSApp } from "dindbos/react";
import "dindbos/styles.css";

function Counter() {
  const [count, setCount] = useState(0);
  const { window } = useDindbOSApp();
  return <main>
    <button onClick={() => setCount(count + 1)}>Count: {count}</button>
    <button onClick={() => window.setTitle(`Count ${count}`)}>Use count as title</button>
    <button onClick={() => window.close()}>Close</button>
  </main>;
}

export default function Desktop() {
  return <DindbOSDesktop style={{ height: 640 }} launch={["counter"]}>
    <DindbOSApp id="counter" name="Counter" icon="calculator" singleton pinned desktop width={420} height={320}>
      <Counter />
    </DindbOSApp>
  </DindbOSDesktop>;
}
```

`DindbOSApp` registers the definition; its content mounts when the app is launched. It is rendered through a portal in your existing React tree, so your own context providers remain available. The initial app declarations register before the desktop's `launch` list is processed.

## App context

`useDindbOSApp()` returns `{ os, content, window, context }`. `os` is the existing permission-checked app facade; it is not the host's unrestricted runtime. `window` provides close, focus, title, and window state operations. `context` is the launch payload.

You can also use a render-function child:

```jsx
<DindbOSApp id="greeting" name="Greeting">
  {({ context }) => <p>Hello {String(context.name || "guest")}</p>}
</DindbOSApp>
```

Declare permissions through `manifest` when the app needs files or runtime capabilities. Use the types exported by `dindbos` for app definitions, file APIs, and window APIs. [App manifests](app-manifest.md) explain the permissions.

## Lifecycle

- Minimize/restore keeps the mounted component and local state.
- Close unmounts that window's content. Reopening creates new component state.
- A singleton launch focuses or restores the existing window. Other apps can open multiple windows.
- Content updates flow through React. Keep an app's `id` stable; changing it unregisters the old app and registers a new one.
- Removing an app declaration unregisters it and closes its windows.
- Leaving the desktop unmounts the runtime. The adapter handles boot cancellation and StrictMode remounts.

Use `useDindbOS()` for host integration when you need `{ os, ready, booting, error }`; do not pass that unrestricted host runtime into an untrusted installed package.

## Embed in an existing route

Place the desktop inside your normal layout and give it a fixed or constrained height. Keep navigation, headings, and the rest of the page outside the desktop. Two independent desktops should have different storage names. Frameworks that render on the server should mount the desktop on the client, as shown in the Next.js and Astro examples.
