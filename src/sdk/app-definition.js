/** Normalize host definitions without losing class prototype methods. */
export function defineApp(definition, render) {
  if (!definition || typeof definition !== "object") throw new TypeError("DindbOS app must be an object or class instance");
  const id = String(definition.id || "").trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new TypeError(`DindbOS app has an invalid id: ${id || "(empty)"}`);
  const mount = render || definition.render;
  if (typeof mount !== "function") throw new TypeError(`DindbOS app ${id} requires a render function`);
  const app = { ...definition, id, name: String(definition.name || id), render: mount.bind(definition) };
  for (const key of ["title", "icon", "pinned", "desktop", "singleton", "width", "height", "accepts", "manifest", "dispose"]) {
    if (key in definition) app[key] = definition[key];
    if (typeof definition[key] === "function") app[key] = definition[key].bind(definition);
  }
  return app;
}
