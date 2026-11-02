export function renderDocumentEditor(os, content, node, windowApi, saveDocument) {
  const controller = new AbortController();
  let documentNode = node || { name: "Untitled", content: "" };
  let toastTimer;
  let modified = false;
  let saving = false;
  let removeCloseGuard;
  content.innerHTML = `<section class="text-app"><textarea aria-label="Document text" spellcheck="false" disabled>Loading…</textarea></section>`;

  const initialize = async () => {
    const local = Boolean(documentNode.path && os.localMounts?.isMountedPath(documentNode.path));
    const text = documentNode.path
      ? local ? await os.localMounts.readFile(documentNode.path) : os.fs.readFile(documentNode.path)
      : documentNode.content || "";
    if (controller.signal.aborted) return;
    content.innerHTML = `<section class="text-app"><textarea aria-label="Document text" spellcheck="false"></textarea><footer><span data-document-info></span><button type="button" data-document-save>Save</button></footer></section>`;
    const textarea = content.querySelector("textarea");
    const info = content.querySelector("[data-document-info]");
    const saveButton = content.querySelector("[data-document-save]");
    textarea.value = String(text);
    const updateInfo = () => {
      info.textContent = `${documentNode.path || "Untitled"} · ${textarea.value.length.toLocaleString()} characters${modified ? " · Edited" : ""}`;
      windowApi.setTitle(`${documentNode.name || "Untitled"}${modified ? " — Edited" : ""}`);
    };
    const showToast = (message) => {
      window.clearTimeout(toastTimer);
      content.querySelector(".app-toast")?.remove();
      const toast = document.createElement("div");
      toast.className = "app-toast";
      toast.setAttribute("role", "status");
      toast.textContent = message;
      content.querySelector(".text-app").appendChild(toast);
      toastTimer = window.setTimeout(() => toast.remove(), 2400);
    };
    const save = async () => {
      if (saving || controller.signal.aborted) return false;
      saving = true;
      saveButton.disabled = true;
      textarea.readOnly = true;
      try {
        if (!documentNode.path) {
          const home = os.session.home || "/home/guest";
          const directory = os.fs.exists(os.fs.join(home, "Documents")) ? os.fs.join(home, "Documents") : home;
          let path = os.fs.join(directory, "Untitled.txt");
          let number = 2;
          while (os.fs.exists(path)) path = os.fs.join(directory, `Untitled ${number++}.txt`);
          const destination = await requestSavePath(content, path, os, controller.signal);
          if (!destination || controller.signal.aborted) return false;
          os.fs.createFile(destination, "/", { content: "", mime: "text/plain" });
          documentNode = { path: destination, name: os.fs.basename(destination), content: "" };
        }
        await saveDocument(os, documentNode, textarea.value);
        if (controller.signal.aborted) return;
        modified = false;
        updateInfo();
        showToast("Document saved");
        return true;
      } catch (error) {
        if (!controller.signal.aborted) {
          info.textContent = `Could not save: ${error.message}`;
          info.setAttribute("role", "alert");
        }
        return false;
      } finally {
        saving = false;
        if (!controller.signal.aborted) {
          saveButton.disabled = false;
          textarea.readOnly = false;
        }
      }
    };
    removeCloseGuard = windowApi.setBeforeClose?.(async () => {
      if (!modified) return true;
      if (saving) return false;
      const choice = await requestCloseDecision(content, documentNode.name || "Untitled", controller.signal);
      if (choice === "discard") return true;
      if (choice === "save") return save();
      return false;
    });
    saveButton.addEventListener("click", save, { signal: controller.signal });
    textarea.addEventListener("input", () => { modified = true; info.removeAttribute("role"); updateInfo(); }, { signal: controller.signal });
    textarea.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        save();
      }
    }, { signal: controller.signal });
    updateInfo();
    textarea.focus({ preventScroll: true });
  };
  initialize().catch((error) => {
    if (controller.signal.aborted) return;
    content.innerHTML = `<section class="text-app"><p role="alert">${escapeText(`Could not open document: ${error.message}`)}</p></section>`;
    windowApi.setTitle("TextEdit — Unable to Open");
  });
  return () => { removeCloseGuard?.(); controller.abort(); window.clearTimeout(toastTimer); };
}

function requestCloseDecision(content, name, signal) {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const sheet = document.createElement("div");
    sheet.className = "app-sheet-backdrop";
    sheet.innerHTML = `<section class="app-save-sheet" role="dialog" aria-modal="true" aria-label="Save changes"><h2>Save changes to ${escapeText(name)}?</h2><p>Your changes will be lost if you close this document without saving.</p><footer><button type="button" data-choice="discard">Don’t Save</button><button type="button" data-choice="cancel">Cancel</button><button type="button" data-choice="save">Save</button></footer></section>`;
    const finish = (choice) => {
      signal.removeEventListener("abort", abort);
      sheet.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(choice);
    };
    const abort = () => finish("cancel");
    signal.addEventListener("abort", abort, { once: true });
    sheet.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => finish(button.dataset.choice)));
    sheet.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); finish("cancel"); }
      if (event.key === "Tab") {
        const buttons = [...sheet.querySelectorAll("button")];
        if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
      }
    });
    content.appendChild(sheet);
    sheet.querySelector('[data-choice="save"]').focus();
  });
}

function requestSavePath(content, initialPath, os, signal) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const sheet = document.createElement("div");
    sheet.className = "app-sheet-backdrop";
    sheet.innerHTML = `<form class="app-save-sheet" role="dialog" aria-modal="true" aria-label="Save document"><h2>Save document</h2><label>File path<input type="text" required aria-label="File path" /></label><p class="app-sheet-error" role="alert"></p><footer><button type="button" data-cancel>Cancel</button><button type="submit">Save</button></footer></form>`;
    const input = sheet.querySelector("input");
    input.value = initialPath;
    const finish = (path = null) => {
      signal.removeEventListener("abort", onAbort);
      sheet.remove();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      resolve(path);
    };
    const onAbort = () => finish();
    signal.addEventListener("abort", onAbort, { once: true });
    sheet.querySelector("[data-cancel]").addEventListener("click", () => finish());
    sheet.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const path = input.value.trim();
      const error = sheet.querySelector("[role='alert']");
      if (!path.startsWith("/") || path.endsWith("/")) { error.textContent = "Enter an absolute file path, including a file name."; return; }
      try {
        const normalized = os.fs.normalize(path);
        if (os.fs.exists(normalized)) { error.textContent = "A file already exists here. Choose a different name."; return; }
        const parent = os.fs.stat(os.fs.dirname(normalized));
        if (!parent || !["directory", "mount"].includes(parent.type)) { error.textContent = "The destination folder does not exist."; return; }
        finish(normalized);
      } catch (failure) {
        error.textContent = failure.message || "The destination folder is unavailable.";
      }
    });
    sheet.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); finish(); }
      if (event.key === "Tab") {
        const fields = [...sheet.querySelectorAll("input,button")];
        if (event.shiftKey && document.activeElement === fields[0]) { event.preventDefault(); fields.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === fields.at(-1)) { event.preventDefault(); fields[0].focus(); }
      }
    });
    content.appendChild(sheet);
    input.focus();
    input.select();
  });
}

function escapeText(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
