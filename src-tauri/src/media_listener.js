(function() {
  if (window.__bushidoMedia) return;
  Object.defineProperty(window, '__bushidoMedia', { value: true, writable: false, configurable: false });
  var lastState = '';
  var lastTime = 0;

  function getMetadata() {
    var meta = {};
    if (navigator.mediaSession && navigator.mediaSession.metadata) {
      var m = navigator.mediaSession.metadata;
      meta.artist = m.artist || '';
      meta.album = m.album || '';
      if (m.artwork && m.artwork.length > 0) meta.artwork = m.artwork[0].src;
      if (m.title) meta.metaTitle = m.title;
    }
    return meta;
  }

  function report(state, force) {
    var media = document.querySelector('video, audio');
    var msg = {
      __bushido: 'media',
      state: state,
      title: document.title,
      currentTime: media ? media.currentTime : 0,
      duration: media ? media.duration : 0,
      playbackRate: media ? media.playbackRate : 1
    };
    var metadata = getMetadata();
    if (metadata.artist) msg.artist = metadata.artist;
    if (metadata.album) msg.album = metadata.album;
    if (metadata.artwork) msg.artwork = metadata.artwork;
    if (metadata.metaTitle) msg.metaTitle = metadata.metaTitle;

    var stateKey = state + '|' + Math.floor(msg.currentTime);
    if (!force && stateKey === lastState) return;
    lastState = stateKey;

    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(JSON.stringify(msg));
    }
  }

  // Event listeners on media elements
  function attachListeners(media) {
    if (media.__bushidoListeners) return;
    media.__bushidoListeners = true;

    media.addEventListener('play', function() { report('playing', true); });
    media.addEventListener('pause', function() { report('paused', true); });
    media.addEventListener('ended', function() { report('ended', true); });

    // throttled timeupdate (every 1s)
    media.addEventListener('timeupdate', function() {
      var now = Date.now();
      if (now - lastTime < 1000) return;
      lastTime = now;
      if (!media.paused && media.readyState > 0) {
        report('playing', false);
      }
    });
  }

  // Poll for media elements and attach listeners
  setInterval(function() {
    var media = document.querySelector('video, audio');
    if (!media) return;
    attachListeners(media);
    if (media.ended) {
      report('ended', false);
    } else if (!media.paused && media.readyState > 0) {
      report('playing', false);
    } else if (media.paused && media.readyState > 0 && media.currentTime > 0) {
      report('paused', false);
    }
  }, 1500);
})();
