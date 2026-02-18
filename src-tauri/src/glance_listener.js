(function() {
  if (window.__bushidoGlance) return;
  window.__bushidoGlance = true;

  function isExternalLink(href) {
    try {
      var target = new URL(href, location.href);
      if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;
      return target.hostname !== location.hostname;
    } catch(e) { return false; }
  }

  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el || !el.href) return;

    var href = el.href;
    try {
      var u = new URL(href, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    } catch(e) { return; }

    // Alt+click: always glance
    if (e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      window.chrome.webview.postMessage(JSON.stringify({
        __bushido: 'glance',
        url: href
      }));
      return;
    }

    // Pinned tab: external links auto-glance
    if (window.__bushidoPinned && isExternalLink(href)) {
      e.preventDefault();
      e.stopPropagation();
      window.chrome.webview.postMessage(JSON.stringify({
        __bushido: 'glance',
        url: href
      }));
    }
  }, true);
})();
