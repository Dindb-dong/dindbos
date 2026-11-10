/** Mobile list/detail navigation decorates existing apps without duplicating their actions. */
export function mountMobileAppNavigation(shell) {
  const { root } = shell;
  const document = root.ownerDocument;
  const returns = new WeakMap();
  const frames = new Set();
  const searches = new Map();
  let queued = false;
  let disposed = false;
  const owns = element => element?.closest?.('.dindbos-host') === root;
  const insert = (parent, attribute, label) => {
    if (!parent || parent.querySelector(`[${attribute}]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(attribute, '');
    button.textContent = label;
    if (attribute === 'data-mobile-app-back') button.setAttribute('aria-label', `Back to ${label}`);
    parent.prepend(button);
  };
  const decorate = () => {
    queued = false;
    if (disposed) return;
    for (const frame of frames) if (!root.contains(frame)) frames.delete(frame);
    for (const [search, marker] of searches) if (!root.contains(search)) { marker.remove(); searches.delete(search); }
    for (const frame of root.querySelectorAll('.dos-window[data-app-id="notes"], .dos-window[data-app-id="settings"]')) {
      if (!owns(frame)) continue;
      frames.add(frame);
      const task = [...shell.os.windows.windows.values()].find(task => task.frame === frame);
      frame.dataset.mobilePane ||= frame.dataset.appId === 'settings' && (task?.context?.section || task?.context?.settingsSection) ? 'detail' : 'list';
      if (frame.dataset.appId === 'notes') {
        insert(frame.querySelector('.notes-sidebar > header'), 'data-mobile-note-new', 'New note');
        const search = frame.querySelector('.notes-editor-toolbar .productivity-search');
        const sidebar = frame.querySelector('.notes-sidebar');
        if (search && sidebar) {
          const marker = document.createComment('mobile search return');
          search.before(marker);
          searches.set(search, marker);
          search.dataset.mobileNoteSearch = '';
          sidebar.querySelector('header').after(search);
        }
        insert(frame.querySelector('.notes-editor-toolbar'), 'data-mobile-app-back', 'Notes');
      } else insert(frame.querySelector('.settings-detail-header'), 'data-mobile-app-back', 'Settings');
    }
  };
  const schedule = () => {
    if (!queued && !disposed) { queued = true; queueMicrotask(decorate); }
  };
  const showList = frame => {
    frame.dataset.mobilePane = 'list';
    const saved = returns.get(frame);
    const replacement = saved?.attribute && [...frame.querySelectorAll(`[${saved.attribute}]`)].find(element => element.getAttribute(saved.attribute) === saved.value);
    (replacement || frame.querySelector('[data-note-id], [data-settings-section-button], [data-mobile-note-new]'))?.focus({ preventScroll: true });
  };
  const click = event => {
    if (!owns(event.target) || shell.os.windows.hasVisibleTrustedSurface?.()) return;
    const frame = event.target.closest('.dos-window');
    if (!frame || !['notes', 'settings'].includes(frame.dataset.appId)) return;
    if (event.target.closest('[data-mobile-app-back]')) { showList(frame); return; }
    const row = event.target.closest('[data-note-id], [data-settings-section-button]');
    if (row) {
      const attribute = row.hasAttribute('data-note-id') ? 'data-note-id' : 'data-settings-section-button';
      returns.set(frame, { attribute, value: row.getAttribute(attribute) });
      frame.dataset.mobilePane = 'detail';
    }
    if (event.target.closest('[data-mobile-note-new]')) {
      frame.dataset.mobilePane = 'detail';
      frame.querySelector('[data-note-new]')?.click();
    } else if (event.target.closest('[data-note-new]')) frame.dataset.mobilePane = 'detail';
  };
  const focus = event => {
    if (!owns(event.target)) return;
    const frame = event.target.closest('.dos-window[data-mobile-pane="list"]');
    if (frame && event.target.closest('.note-editor, .settings-detail')) frame.dataset.mobilePane = 'detail';
  };
  const navigate = event => {
    if (!owns(event.target)) return;
    const frame = event.target.closest('.dos-window[data-app-id="settings"]');
    if (frame) frame.dataset.mobilePane = 'detail';
  };
  const back = event => {
    if (!owns(event.target) || shell.os.windows.hasVisibleTrustedSurface?.()) return;
    const frame = event.target.closest('.dos-window[data-mobile-pane="detail"]');
    if (!frame || !['notes', 'settings'].includes(frame.dataset.appId)) return;
    showList(frame);
    event.preventDefault();
  };
  const keydown = event => {
    if (!owns(event.target) || shell.os.windows.hasVisibleTrustedSurface?.()) return;
    const frame = event.target.closest('.dos-window[data-app-id="notes"]');
    if (frame && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') frame.dataset.mobilePane = 'detail';
  };
  const Observer = document.defaultView.MutationObserver;
  const observer = new Observer(schedule);
  observer.observe(root, { childList: true, subtree: true });
  root.addEventListener('click', click, true);
  root.addEventListener('focusin', focus);
  root.addEventListener('dindbos:settings-navigate', navigate, true);
  root.addEventListener('dindbos:back', back);
  root.addEventListener('keydown', keydown, true);
  decorate();
  return () => {
    disposed = true;
    observer.disconnect();
    root.removeEventListener('click', click, true);
    root.removeEventListener('focusin', focus);
    root.removeEventListener('dindbos:settings-navigate', navigate, true);
    root.removeEventListener('dindbos:back', back);
    root.removeEventListener('keydown', keydown, true);
    for (const [search, marker] of searches) {
      marker.replaceWith(search);
      delete search.dataset.mobileNoteSearch;
    }
    searches.clear();
    for (const frame of frames) {
      delete frame.dataset.mobilePane;
      frame.querySelectorAll('[data-mobile-app-back], [data-mobile-note-new]').forEach(button => button.remove());
    }
  };
}
