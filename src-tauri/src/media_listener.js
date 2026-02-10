(function() {
  if (window.__bushidoMedia) return;
  Object.defineProperty(window, '__bushidoMedia', { value: true, writable: false, configurable: false });
  var lastState = '';
  function report(state) {
    if (state === lastState) return;
    lastState = state;
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(JSON.stringify({
        __bushido: 'media', state: state, title: document.title
      }));
    }
  }
  setInterval(function() {
    var media = document.querySelector('video, audio');
    if (!media) return;
    if (media.ended) {
      report('ended');
    } else if (!media.paused && media.readyState > 0) {
      report('playing');
    } else if (media.paused && media.readyState > 0 && media.currentTime > 0) {
      report('paused');
    }
  }, 1500);
})();
