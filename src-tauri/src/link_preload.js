(function() {
  if (window.__bushidoPreload) return;
  window.__bushidoPreload = true;

  var timer = null;
  var currentUrl = null;

  function isPreloadable(href) {
    try {
      var u = new URL(href, location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      // same-origin only
      if (u.origin !== location.origin) return false;
      // skip same-page anchors
      if (u.pathname === location.pathname && u.search === location.search && u.hash) return false;
      return true;
    } catch(e) { return false; }
  }

  document.addEventListener('mouseenter', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el || !el.href) return;

    var href = el.href;
    if (!isPreloadable(href)) return;
    if (href === currentUrl) return;

    // clear any previous timer
    if (timer) { clearTimeout(timer); timer = null; }

    timer = setTimeout(function() {
      currentUrl = href;
      window.chrome.webview.postMessage(JSON.stringify({
        __bushido: 'preload',
        url: href
      }));
    }, 300);
  }, true);

  document.addEventListener('mouseleave', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentElement;
    if (!el || !el.href) return;

    if (timer) { clearTimeout(timer); timer = null; }

    if (currentUrl) {
      window.chrome.webview.postMessage(JSON.stringify({
        __bushido: 'preload-cancel',
        url: currentUrl
      }));
      currentUrl = null;
    }
  }, true);
})();
