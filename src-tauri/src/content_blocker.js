(function() {
    'use strict';
    if (window.__bushidoPrivacy) return;
    Object.defineProperty(window, '__bushidoPrivacy', { value: true, writable: false, configurable: false });

    // WebRTC leak prevention
    try {
        var origRTC = window.RTCPeerConnection || window.webkitRTCPeerConnection;
        if (origRTC) {
            var wrappedRTC = function(config, constraints) {
                if (config && config.iceServers) {
                    config.iceServers = config.iceServers.filter(function(s) {
                        var urls = s.urls || s.url || '';
                        if (typeof urls === 'string') urls = [urls];
                        return !urls.some(function(u) { return u.indexOf('stun:') === 0 || u.indexOf('turn:') === 0; });
                    });
                }
                return new origRTC(config, constraints);
            };
            wrappedRTC.prototype = origRTC.prototype;
            window.RTCPeerConnection = wrappedRTC;
            if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = wrappedRTC;
        }
    } catch(e) {}

})();
