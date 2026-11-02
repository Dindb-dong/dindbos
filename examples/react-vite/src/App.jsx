import React, { useState } from "react";
import { DindbOSDesktop, DindbOSApp, useDindbOSApp } from "dindbos/react";
import "dindbos/styles.css";

function Counter() {
  const [count, setCount] = useState(0);
  const { window } = useDindbOSApp();
  return <main style={{ padding: 24 }}>
    <h1>Your React app</h1>
    <p>Minimize and restore to keep the counter. Close and reopen for a new instance.</p>
    <button onClick={() => setCount(count + 1)}>Count: {count}</button>{" "}
    <button onClick={() => window.close()}>Close</button>
  </main>;
}

export default function App() {
  return <DindbOSDesktop
    style={{ height: "100dvh" }}
    theme={{ mode: "system", accent: "#287a58", wallpaper: "meadow", dockSize: 52 }}
    storage={{ name: "react-example" }}
    fileSystem={{ "/home/guest/readme.md": "# dindbOS in React\n" }}
    builtins={{ includePortfolio: false }}
    launch={["counter"]}
  >
    <DindbOSApp id="counter" name="Counter" icon="calculator" pinned desktop width={480} height={320}>
      <Counter />
    </DindbOSApp>
  </DindbOSDesktop>;
}
