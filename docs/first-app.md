# Build your first app

Choose React for a component-based host, or `defineApp` for an imperative function or class. Both paths register apps in the same runtime.

## React

```jsx
import React from "react";
import { DindbOSDesktop, DindbOSApp } from "dindbos/react";
import "dindbos/styles.css";

export default function Desktop() {
  return <DindbOSDesktop style={{ height: 600 }} launch={["hello"]}>
    <DindbOSApp id="hello" name="Hello" pinned desktop>
      <main><h1>Hello from my site</h1></main>
    </DindbOSApp>
  </DindbOSDesktop>;
}
```

[React app context and lifecycle](react-apps.md).

## JavaScript function

```js
import { createAndBootDindbOS, defineApp } from "dindbos";
import "dindbos/styles.css";

const hello = defineApp({ id: "hello", name: "Hello", pinned: true }, ({ content, window }) => {
  const button = document.createElement("button");
  button.textContent = "Close Hello";
  button.onclick = () => window.close();
  content.replaceChildren(button);
  return () => { button.onclick = null; };
});
const desktop = createAndBootDindbOS({ root: "#desktop", apps: [hello], launch: ["hello"] });
// In route cleanup: desktop.then((os) => os.destroy());
```

`render` receives `{ os, content, window, context }`. Its optional returned cleanup runs when the app window is closed or the runtime is destroyed. Minimize keeps the app alive.

## JavaScript class

```js
import { defineApp } from "dindbos";

class GreetingApp {
  id = "greeting";
  name = "Greeting";
  pinned = true;
  greeting = "Hello from a class";
  render({ content }) {
    const heading = document.createElement("h1");
    heading.textContent = this.greeting;
    content.replaceChildren(heading);
  }
}
const greeting = defineApp(new GreetingApp());
```

Normalization binds prototype methods to the instance. Register `greeting` in the host's `apps` array. Keep resource cleanup per rendered window when multiple windows are allowed.

## Protect unsaved work

Inside a Vanilla render callback, register `window.setBeforeClose(() => boolean | Promise<boolean>)` and return its unregister function with your other cleanup. In React, obtain the same window from `useDindbOSApp()`. Returning `false` keeps the window open; concurrent close requests share one pending decision. Forced runtime teardown and removal of an app declaration bypass this guard and still release resources. TextEdit uses this API for its Save / Don’t Save / Cancel sheet.

## Add an app with the CLI

In a generated project:

```sh
npm exec --package=dindbos -- create-dindbos add app notes --yes --json
```

This writes one app source and adds it to `src/apps/index.js`. It stops if the app already exists or registry markers are missing. Edit the generated app, run the build, then launch it from the desktop.

## Installed package apps

An installed package app declares `dindbos.app.json` and uses the runtime's package/manifest path rather than host JSX. See [app manifests](app-manifest.md), [app APIs](app-apis.md), and [package isolation](isolation.md). Keep its file and capability permissions narrow. Host component registration does not grant privileges to installed packages.
