import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mountDindbOSDesktop } from "./desktop.js";
import { applyDindbOSTheme } from "./host-config.js";
import { defineApp } from "./app-definition.js";

const h = React.createElement;
const DindbOSContext = createContext({ os: null, ready: false, booting: false, error: null });
const AppContext = createContext(null);
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export { defineApp };

export function DindbOSProvider({ os = null, error = null, booting = false, children }) {
  const value = useMemo(() => ({ os, ready: Boolean(os), booting, error }), [os, error, booting]);
  return h(DindbOSContext.Provider, { value }, children);
}

export function useDindbOS() {
  return useContext(DindbOSContext);
}

export function useDindbOSApp() {
  const app = useContext(AppContext);
  if (!app) throw new Error("useDindbOSApp must be used inside a running DindbOSApp");
  return app;
}

export function DindbOSDesktop({ options = {}, className = "dindbos-react-root", style, onReady, onError, children = null, ...hostOptions }) {
  const rootRef = useRef(null);
  const optionsRef = useRef(null);
  const callbacksRef = useRef(null);
  const bootQueue = useRef(Promise.resolve());
  const generation = useRef(0);
  const [state, setState] = useState({ os: null, booting: true, error: null });
  optionsRef.current = { ...options, ...hostOptions };
  callbacksRef.current = { onReady, onError };

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    let runtime = null;
    const bootOptions = optionsRef.current;
    const pending = bootQueue.current.catch(() => {}).then(async () => {
      if (controller.signal.aborted) return;
      try {
        runtime = await mountDindbOSDesktop({ ...bootOptions, root: rootRef.current, launch: [], signal: controller.signal });
        if (controller.signal.aborted) {
          await runtime.destroy?.();
          return;
        }
        setState({ os: runtime, booting: false, error: null });
      } catch (error) {
        await runtime?.destroy?.();
        if (!controller.signal.aborted && generation.current === current) {
          setState({ os: null, booting: false, error });
          callbacksRef.current.onError?.(error);
        }
      }
    });
    bootQueue.current = pending;
    return () => {
      controller.abort();
      bootQueue.current = pending.then(() => runtime?.destroy?.()).catch((error) => callbacksRef.current.onError?.(error));
    };
  }, []);

  useEffect(() => {
    if (!state.os || state.os.destroyed) return;
    try {
      for (const entry of optionsRef.current.launch || []) {
        if (typeof entry === "string") state.os.launch(entry);
        else state.os.launch(entry.id, entry.context || {});
      }
      callbacksRef.current.onReady?.(state.os);
    } catch (error) {
      setState((value) => ({ ...value, error }));
      callbacksRef.current.onError?.(error);
    }
  }, [state.os]);

  useEffect(() => {
    if (state.os) applyDindbOSTheme(state.os, optionsRef.current.theme || {});
  }, [state.os, options.theme, hostOptions.theme]);

  return h(DindbOSProvider, state,
    h("div", { ref: rootRef, className: `dindbos-host ${className}`, style, "data-dindbos-react-root": "" }),
    children,
  );
}

/** Declares a host React app; each launched window receives a context-preserving portal. */
export function DindbOSApp({ children, ...definition }) {
  const { os } = useDindbOS();
  const propsRef = useRef(null);
  const ownedRef = useRef(null);
  const [surfaces, setSurfaces] = useState([]);
  propsRef.current = { children, ...definition };

  useClientLayoutEffect(() => {
    if (!os || os.destroyed) return;
    if (os.apps.has(definition.id)) throw new Error(`DindbOSApp id is already registered: ${definition.id}`);
    let active = true;
    const app = defineApp({ ...propsRef.current, render(context) {
      if (!active) return;
      const surface = { context, key: context.window.id };
      setSurfaces((items) => [...items.filter((item) => item.key !== surface.key), surface]);
      return () => {
        if (active) setSurfaces((items) => items.filter((item) => item !== surface));
      };
    } });
    os.registerApp(app);
    ownedRef.current = app;
    return () => {
      active = false;
      if (!os.destroyed) os.unregisterApp(app.id);
      ownedRef.current = null;
      setSurfaces([]);
    };
  }, [os, definition.id]);

  useClientLayoutEffect(() => {
    const app = ownedRef.current;
    if (!os || !app || os.destroyed) return;
    let changed = false;
    for (const key of ["name", "title", "icon", "pinned", "category", "accepts", "associationPriority", "desktop", "width", "height", "chrome", "sidebarWidth", "minWidth", "minHeight", "menus"]) {
      if (app[key] !== definition[key]) { app[key] = definition[key]; changed = true; }
    }
    if (!changed) return;
    os.registerApp(app);
    for (const task of os.windows.windows.values()) {
      if (task.appId !== app.id) continue;
      const title = typeof app.title === "function" ? app.title(task.context || {}) : app.title || app.name || app.id;
      task.api.setTitle(title);
    }
  });

  return surfaces.map(({ context, key }) => createPortal(
    h(AppContext.Provider, { value: context },
      h(AppErrorBoundary, { onError: definition.onError }, h(AppContent, { context, children })),
    ), context.content, key,
  ));
}

function AppContent({ context, children }) {
  return typeof children === "function" ? children(context) : children;
}

class AppErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error) { this.props.onError?.(error); }
  render() {
    if (this.state.error) return h("section", { className: "crash-app", role: "alert" },
      h("h2", null, "This app could not render"), h("p", null, this.state.error.message));
    return this.props.children;
  }
}
