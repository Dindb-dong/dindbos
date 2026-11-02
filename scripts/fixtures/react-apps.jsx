import React, { StrictMode, createContext, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DindbOSDesktop, DindbOSApp, useDindbOSApp } from "../../src/sdk/react.js";

const HostContext = createContext("missing context");
const storage = { backend: "memory", name: "react-sdk-fixture" };
window.__sdkFixture = { ready: 0, cleanup: 0, errors: [] };

function Counter({ label }) {
  const inherited = useContext(HostContext);
  const app = useDindbOSApp();
  const [count, setCount] = useState(0);
  useEffect(() => () => { window.__sdkFixture.cleanup += 1; }, []);
  return <section data-testid="counter-app">
    <p data-testid="host-context">{inherited}</p>
    <p data-testid="live-label">{label}</p>
    <button data-testid="increment" onClick={() => setCount((n) => n + 1)}>Count {count}</button>
    <button data-testid="close-app" onClick={() => app.window.close()}>Close app</button>
    <span data-testid="app-identity">{app.context.message}</span>
  </section>;
}

function Fixture() {
  const [mounted, setMounted] = useState(true);
  const [label, setLabel] = useState("Before update");
  const [appId, setAppId] = useState("counter");
  return <HostContext.Provider value="host context preserved">
    <button data-testid="toggle-desktop" onClick={() => setMounted((value) => !value)}>Toggle desktop</button>
    <button data-testid="change-app-id" onClick={() => setAppId("counter-renamed")}>Change app ID</button>
    <button data-testid="update-label" onClick={() => setLabel("After update")}>Update label</button>
    {mounted && <DindbOSDesktop style={{ width: 720, height: 540, position: "relative" }}
      storage={storage} builtins={false} bootstrapPackages={false} bootScreen={false}
      launch={[{ id: appId, context: { message: "launch context preserved" } }]}
      onReady={(os) => { window.__sdkFixture.os = os; window.__sdkFixture.ready += 1; }}
      onError={(error) => window.__sdkFixture.errors.push(error.stack || error.message)}>
      <DindbOSApp id={appId} name="Counter" title={(context) => `${label}: ${context.message}`} singleton pinned width={420} height={260}>
        <Counter label={label} />
      </DindbOSApp>
    </DindbOSDesktop>}
    <p data-testid="host-after">Host content remains available</p>
  </HostContext.Provider>;
}
createRoot(document.getElementById("root")).render(<StrictMode><Fixture /></StrictMode>);
