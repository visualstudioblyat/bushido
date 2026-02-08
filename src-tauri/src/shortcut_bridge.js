(function() {
  if (window.__bushidoShortcuts) return;
  window.__bushidoShortcuts = true;
  var seq = 0;
  function handler(e) {
    var action = null;
    if (e.ctrlKey && e.shiftKey && (e.code === 'KeyB')) action = 'toggle-compact';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyT') action = 'new-tab';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyW') action = 'close-tab';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyL') action = 'focus-url';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyF') action = 'find';
    else if (e.ctrlKey && !e.shiftKey && e.code === 'KeyB') action = 'toggle-sidebar';
    if (action) {
      e.preventDefault();
      e.stopImmediatePropagation();
      var savedTitle = document.title;
      seq++;
      document.title = '__BUSHIDO_SHORTCUT__:' + action + ':' + seq;
      setTimeout(function() { document.title = savedTitle; }, 50);
    }
  }
  window.addEventListener('keydown', handler, true);
  document.addEventListener('keydown', handler, true);
})();
