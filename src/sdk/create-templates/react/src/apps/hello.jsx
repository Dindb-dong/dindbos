import React, { useState } from "react";
import { useDindbOSApp } from "dindbos/react";

export default function HelloApp() {
  const [count, setCount] = useState(0);
  const { window } = useDindbOSApp();
  return <main className="starter-app">
    <h1>Your first desktop app</h1>
    <p>Edit src/apps/hello.jsx. Your React context and state stay in your app.</p>
    <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>{" "}
    <button onClick={() => window.close()}>Close window</button>
  </main>;
}
