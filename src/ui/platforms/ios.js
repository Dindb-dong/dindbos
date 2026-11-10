export function mountIOSShell(shell) {
  const document = shell.root.ownerDocument;
  const home = document.createElement("button");
  home.type = "button";
  home.className = "dos-ios-home";
  home.setAttribute("aria-label", "Home");
  home.innerHTML = '<span aria-hidden="true"></span>';
  const showHome = () => {
    if (shell.os.windows.hasVisibleTrustedSurface?.()) return;
    shell.closePanel(false);
    for (const task of shell.os.windows.windows.values()) {
      if (!task.minimized) shell.os.windows.minimize(task.id);
    }
    home.focus({ preventScroll: true });
  };
  home.addEventListener("click", showHome);
  shell.refs.shell.appendChild(home);

  let search;
  if (!shell.os.uiOptions?.slots?.desktop) {
    search = document.createElement("button");
    search.type = "button";
    search.className = "dos-ios-search";
    search.dataset.shellPanel = "launcher";
    search.setAttribute("aria-haspopup", "dialog");
    search.setAttribute("aria-expanded", "false");
    search.textContent = "Search";
    shell.refs.shell.appendChild(search);
  }
  return () => {
    home.removeEventListener("click", showHome);
    home.remove();
    search?.remove();
  };
}
