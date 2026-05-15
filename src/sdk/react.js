import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { mountDindbOSDesktop } from "./desktop.js";

const h = React.createElement;
const DindbOSContext = createContext({ os: null, ready: false, booting: false, error: null });

export function DindbOSProvider({ os = null, error = null, booting = false, children }) {
  const value = useMemo(() => ({ os, ready: Boolean(os), booting, error }), [os, error, booting]);
  return h(DindbOSContext.Provider, { value }, children);
}

export function useDindbOS() {
  return useContext(DindbOSContext);
}

export function DindbOSDesktop({
  options = {},
  className = "dindbos-react-root",
  style,
  onReady,
  onError,
  children = null,
  ...hostOptions
}) {
  const rootRef = useRef(null);
  const bootOptionsRef = useRef(null);
  const [state, setState] = useState({ os: null, booting: true, error: null });
  bootOptionsRef.current = { ...options, ...hostOptions };

  useEffect(() => {
    let mounted = true;
    const root = rootRef.current;
    if (!root) return () => {};

    mountDindbOSDesktop({ ...bootOptionsRef.current, root })
      .then((os) => {
        if (!mounted) return;
        setState({ os, booting: false, error: null });
        onReady?.(os);
      })
      .catch((error) => {
        if (!mounted) return;
        setState({ os: null, booting: false, error });
        onError?.(error);
      });

    return () => {
      mounted = false;
      if (root) root.innerHTML = "";
    };
  }, []);

  return h(
    DindbOSProvider,
    state,
    h("div", { ref: rootRef, className, style, "data-dindbos-react-root": "" }),
    children,
  );
}
