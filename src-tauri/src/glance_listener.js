(function() {
  if (window.__bushidoGlance) return;
  window.__bushidoGlance = true;

  // one-time tooltip
  try {
    if (!localStorage.getItem('__bushidoGlanceTipShown')) {
      localStorage.setItem('__bushidoGlanceTipShown', '1');
      var tip = document.createElement('div');
      tip.textContent = 'Alt+Click links to preview';
      tip.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;padding:8px 16px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity 0.3s';
      (document.body || document.documentElement).appendChild(tip);
      requestAnimationFrame(function() { tip.style.opacity = '1'; });
      setTimeout(function() {
        tip.style.opacity = '0';
        setTimeout(function() { tip.remove(); }, 300);
      }, 3000);
    }
  } catch(e) {}

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
