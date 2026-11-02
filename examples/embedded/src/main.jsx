import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { DindbOSDesktop, DindbOSApp } from "dindbos/react";
import "dindbos/styles.css";
import "./site.css";

// QA instrumentation exists only when this example is opened with ?qa=1.
const qa = new URLSearchParams(location.search).has("qa") ? { runtimes: {}, errors: [] } : null;
if (qa) window.__dindbosEmbedQA = qa;
const onReady = (name) => (os) => { if (qa) qa.runtimes[name] = os; };
const onError = (error) => { if (qa) qa.errors.push(error.stack || error.message); };

function Notebook({ name, nested = false }) {
  const [items, setItems] = useState([false, true, false]);
  const [showNested, setShowNested] = useState(false);
  return <div className="embedded-notebook" data-testid={`notes-${name}`}>
    <h2>{nested ? "Nested notebook" : "A small notebook"}</h2>
    <p>These checkboxes belong to this app. The surrounding page keeps its own styles and controls.</p>
    {["Sketch the next idea", "Make a working prototype", "Share something useful"].map((label, index) =>
      <label key={label}><input type="checkbox" checked={items[index]} onChange={() => setItems((previous) => previous.map((value, position) => position === index ? !value : value))} />{label}</label>)}
    <input aria-label={`${name} notebook title`} defaultValue="Ideas for the weekend" />
    {!nested && <button type="button" data-testid={`nested-toggle-${name}`} onClick={() => setShowNested((value) => !value)}>{showNested ? "Close nested desktop" : "Try a nested desktop"}</button>}
    {showNested && <div className="nested-example" data-testid="nested-container"><Desktop name="nested" nested /></div>}
  </div>;
}

function Desktop({ name, dark = false, nested = false }) {
  return <DindbOSDesktop
    className={`embedded-desktop embedded-desktop-${name}`}
    storage={{ backend: "memory", name: `embedded-${name}` }}
    builtins={false} bootstrapPackages={false} bootScreen={false}
    theme={{ mode: dark ? "dark" : "light", accent: dark ? "#4c91b5" : "#287a58", wallpaper: dark ? "coast" : "meadow", dockSize: nested ? 36 : 44 }}
    launch={["notes"]} onReady={onReady(name)} onError={onError}>
    <DindbOSApp id="notes" name="Notebook" title="Notebook" icon="document" singleton pinned desktop width={nested ? 280 : 500} height={nested ? 210 : 330}>
      <Notebook name={name} nested={nested} />
    </DindbOSApp>
  </DindbOSDesktop>;
}

function Site() {
  const [saved, setSaved] = useState(0);
  const [showFirst, setShowFirst] = useState(true);
  return <main className="host-site">
    <header className="host-header"><a href="#examples">Field notes</a><span>A website with room for a desktop</span></header>
    <section className="host-introduction">
      <h1>Your page stays your page.</h1>
      <p>Each desktop below has its own apps, appearance, storage, and window manager. They sit inside ordinary content, with no full-page takeover.</p>
      <div className="host-toolbar">
        <input data-testid="host-input" aria-label="Host page title" defaultValue="A page of ideas" />
        <button className="host-button" data-testid="host-save" type="button" onClick={() => setSaved((value) => value + 1)}>Save draft</button>
        <span data-testid="host-saved">Saved {saved} times</span>
      </div>
    </section>
    <section className="desktop-examples" id="examples" aria-label="Independent desktops">
      <article className="desktop-example"><h2>Workspace</h2><div data-testid="first-container" className="first-container">{showFirst ? <Desktop name="first" /> : <p className="removed-desktop">The desktop has been removed. This is still your page.</p>}</div></article>
      <article className="desktop-example"><h2>A smaller canvas</h2><div data-testid="second-container" className="second-container"><Desktop name="second" dark /></div></article>
    </section>
    <button className="host-button" data-testid="toggle-first" type="button" onClick={() => setShowFirst((value) => !value)}>{showFirst ? "Remove workspace" : "Restore workspace"}</button>
    <section className="host-after"><h2>Keep reading.</h2><p>Normal page content continues below the desktops. Scroll, use the page controls, or remove a desktop without affecting the rest of the site.</p><a href="#top" data-testid="host-bottom">Back to the top</a></section>
  </main>;
}

createRoot(document.getElementById("root")).render(<Site />);
