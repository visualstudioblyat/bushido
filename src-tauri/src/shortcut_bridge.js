(function() {
  if (window.__bushidoShortcuts) return;
  Object.defineProperty(window, '__bushidoShortcuts', { value: true, writable: false, configurable: false });
  function handler(e) {
    var action = null;
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyB')) action = 'toggle-compact';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyT') action = 'new-tab';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyW') action = 'close-tab';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyL') action = 'focus-url';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF') action = 'find';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyB') action = 'toggle-sidebar';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyD') action = 'bookmark';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyH') action = 'history';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyK') action = 'command-palette';
    else if (e.ctrlKey && e.shiftKey && e.code === 'KeyR') action = 'reader-mode';
    if (action) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ __bushido: 'shortcut', action: action }));
      }
    }
  }
  window.addEventListener('keydown', handler, true);
  document.addEventListener('keydown', handler, true);
})();
