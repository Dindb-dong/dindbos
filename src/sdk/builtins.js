export { installBuiltinApps } from "../dindbos/apps/builtins.js";
export { BROWSER_LOCAL_HTML_SANDBOX } from "../dindbos/apps/builtins.js";

import { installBuiltinApps } from "../dindbos/apps/builtins.js";

export function installDindbOSBuiltins(os, options = {}) {
  return installBuiltinApps(os, options);
}
