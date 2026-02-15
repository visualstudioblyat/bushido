(function() {
    'use strict';
    if (window.__bushidoFingerprint) return;
    Object.defineProperty(window, '__bushidoFingerprint', { value: true, writable: false, configurable: false });

    // per-session xorshift128+ prng
    var seed = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
    var s0 = seed ^ 0xDEADBEEF, s1 = seed ^ 0xCAFEBABE;
    function rng() {
        var a = s0, b = s1;
        s0 = b;
        a ^= (a << 23) | 0;
        a ^= a >>> 17;
        a ^= b;
        a ^= b >>> 26;
        s1 = a;
        return ((a + b) >>> 0) / 0xFFFFFFFF;
    }

    // tostring hardening
    var ns = 'function () { [native code] }';
    function harden(obj, prop) {
        try {
            var fn = typeof prop === 'string' ? obj[prop] : obj;
            if (fn && typeof fn === 'function') {
                fn.toString = function() { return ns; };
                fn.toLocaleString = function() { return ns; };
            }
        } catch(e) {}
    }

    // referrer policy
    try {
        var meta = document.createElement('meta');
        meta.setAttribute('name', 'referrer');
        meta.setAttribute('content', 'origin');
        (document.head || document.documentElement).appendChild(meta);
    } catch(e) {}

    // navigator props
    try { Object.defineProperty(navigator, 'doNotTrack', { get: function() { return '1'; }, configurable: true }); } catch(e) {}
    try { Object.defineProperty(navigator, 'globalPrivacyControl', { get: function() { return true; }, configurable: true }); } catch(e) {}
    try {
        Object.defineProperty(navigator, 'plugins', { get: function() { return []; }, configurable: true });
        Object.defineProperty(navigator, 'mimeTypes', { get: function() { return []; }, configurable: true });
    } catch(e) {}
    try { if (navigator.getBattery) navigator.getBattery = undefined; } catch(e) {}
    try {
        Object.defineProperty(navigator, 'language', { get: function() { return 'en-US'; }, configurable: false });
        Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US','en']; }, configurable: false });
    } catch(e) {}
    try { Object.defineProperty(navigator, 'platform', { get: function() { return 'Win32'; }, configurable: false }); } catch(e) {}
    try {
        Object.defineProperty(navigator, 'connection', { get: function() { return undefined; }, configurable: false });
        Object.defineProperty(navigator, 'mozConnection', { get: function() { return undefined; }, configurable: false });
        Object.defineProperty(navigator, 'webkitConnection', { get: function() { return undefined; }, configurable: false });
    } catch(e) {}
    try { Object.defineProperty(navigator, 'webdriver', { get: function() { return false; }, configurable: false }); } catch(e) {}
    try { Object.defineProperty(navigator, 'deviceMemory', { get: function() { return 8; }, configurable: false }); } catch(e) {}
    try { Object.defineProperty(navigator, 'maxTouchPoints', { get: function() { return 0; }, configurable: false }); } catch(e) {}
    try { Object.defineProperty(navigator, 'pdfViewerEnabled', { get: function() { return true; }, configurable: false }); } catch(e) {}
    try { Object.defineProperty(navigator, 'cookieEnabled', { get: function() { return true; }, configurable: false }); } catch(e) {}

    // screen normalization
    try {
        Object.defineProperty(screen, 'width', { get: function() { return 1920; }, configurable: false });
        Object.defineProperty(screen, 'height', { get: function() { return 1080; }, configurable: false });
        Object.defineProperty(screen, 'availWidth', { get: function() { return 1920; }, configurable: false });
        Object.defineProperty(screen, 'availHeight', { get: function() { return 1040; }, configurable: false });
        Object.defineProperty(screen, 'availLeft', { get: function() { return 0; }, configurable: false });
        Object.defineProperty(screen, 'availTop', { get: function() { return 0; }, configurable: false });
        Object.defineProperty(screen, 'colorDepth', { get: function() { return 24; }, configurable: false });
        Object.defineProperty(screen, 'pixelDepth', { get: function() { return 24; }, configurable: false });
    } catch(e) {}
    try { Object.defineProperty(window, 'devicePixelRatio', { get: function() { return 1; }, configurable: false }); } catch(e) {}

    // canvas fingerprint noise
    try {
        var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        var origToBlob = HTMLCanvasElement.prototype.toBlob;
        var origGetCtx = HTMLCanvasElement.prototype.getContext;
        var addNoise = function(canvas) {
            try {
                var ctx = origGetCtx.call(canvas, '2d');
                if (!ctx) return;
                var w = canvas.width, h = canvas.height;
                if (w === 0 || h === 0 || w > 4096 || h > 4096) return;
                var img = ctx.getImageData(0, 0, w, h);
                var d = img.data;
                for (var i = 0; i < d.length; i += 4) {
                    var r = rng();
                    d[i] = d[i] ^ (r > 0.5 ? 1 : 0);
                    d[i+1] = d[i+1] ^ (r > 0.75 ? 1 : 0);
                }
                ctx.putImageData(img, 0, 0);
            } catch(e) {}
        };
        HTMLCanvasElement.prototype.toDataURL = function() {
            addNoise(this);
            return origToDataURL.apply(this, arguments);
        };
        HTMLCanvasElement.prototype.toBlob = function() {
            addNoise(this);
            return origToBlob.apply(this, arguments);
        };
        harden(HTMLCanvasElement.prototype, 'toDataURL');
        harden(HTMLCanvasElement.prototype, 'toBlob');
    } catch(e) {}

    // webgl vendor/renderer (per-session from pool)
    try {
        // weighted toward common intel igpus (most common in fingerprint databases)
        var gpus = [
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ];
        var gi = Math.floor(rng() * gpus.length);
        var sv = gpus[gi][0], sr = gpus[gi][1];

        var origGP = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(p) {
            if (p === 37445) return sv;
            if (p === 37446) return sr;
            return origGP.call(this, p);
        };
        harden(WebGLRenderingContext.prototype, 'getParameter');

        if (typeof WebGL2RenderingContext !== 'undefined') {
            var origGP2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(p) {
                if (p === 37445) return sv;
                if (p === 37446) return sr;
                return origGP2.call(this, p);
            };
            harden(WebGL2RenderingContext.prototype, 'getParameter');
        }

        // shader precision normalization
        var origPrec = WebGLRenderingContext.prototype.getShaderPrecisionFormat;
        WebGLRenderingContext.prototype.getShaderPrecisionFormat = function(st, pt) {
            var r = origPrec.call(this, st, pt);
            if (!r) return r;
            return { rangeMin: r.rangeMin, rangeMax: r.rangeMax, precision: r.precision };
        };
        harden(WebGLRenderingContext.prototype, 'getShaderPrecisionFormat');
    } catch(e) {}

    // audio fingerprint — noise on all output paths
    var audioNoise = (rng() - 0.5) * 0.01;
    try {
        var origGF = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = function(arr) {
            origGF.call(this, arr);
            for (var i = 0; i < arr.length; i++) arr[i] += audioNoise;
        };
        harden(AnalyserNode.prototype, 'getFloatFrequencyData');
    } catch(e) {}
    try {
        var origGFT = AnalyserNode.prototype.getFloatTimeDomainData;
        AnalyserNode.prototype.getFloatTimeDomainData = function(arr) {
            origGFT.call(this, arr);
            for (var i = 0; i < arr.length; i++) arr[i] += audioNoise;
        };
        harden(AnalyserNode.prototype, 'getFloatTimeDomainData');
    } catch(e) {}

    // offline audio context noise + getChannelData hook
    try {
        var origSR = OfflineAudioContext.prototype.startRendering;
        OfflineAudioContext.prototype.startRendering = function() {
            return origSR.call(this).then(function(buf) {
                try {
                    var origGCD = buf.getChannelData.bind(buf);
                    buf.getChannelData = function(ch) {
                        var d = origGCD(ch);
                        for (var i = 0; i < d.length; i++) d[i] += audioNoise;
                        return d;
                    };
                } catch(e) {}
                return buf;
            });
        };
        harden(OfflineAudioContext.prototype, 'startRendering');
    } catch(e) {}
    // hook AudioBuffer.getChannelData globally
    try {
        var origABGCD = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(ch) {
            var d = origABGCD.call(this, ch);
            if (!this.__bushidoNoised) {
                this.__bushidoNoised = true;
                for (var i = 0; i < d.length; i++) d[i] += audioNoise;
            }
            return d;
        };
        harden(AudioBuffer.prototype, 'getChannelData');
    } catch(e) {}

    // performance.now clamping
    try {
        var origPN = performance.now.bind(performance);
        var CL = 16.67;
        performance.now = function() {
            var t = origPN();
            var c = Math.floor(t / CL) * CL;
            c += Math.floor(rng() * 6) * CL;
            return c;
        };
        harden(performance, 'now');
    } catch(e) {}

    // performance.memory
    try {
        if (performance.memory) {
            Object.defineProperty(performance, 'memory', {
                get: function() { return { jsHeapSizeLimit: 2172649472, totalJSHeapSize: 10000000, usedJSHeapSize: 10000000 }; },
                configurable: false
            });
        }
    } catch(e) {}

    // api stubs
    try {
        if (window.speechSynthesis) {
            window.speechSynthesis.getVoices = function() { return []; };
            window.speechSynthesis.addEventListener = function() {};
            harden(window.speechSynthesis, 'getVoices');
        }
    } catch(e) {}
    try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices = function() { return Promise.resolve([]); };
            harden(navigator.mediaDevices, 'enumerateDevices');
        }
    } catch(e) {}
    try {
        if (navigator.storage && navigator.storage.estimate) {
            navigator.storage.estimate = function() { return Promise.resolve({ quota: 1073741824, usage: 0 }); };
            harden(navigator.storage, 'estimate');
        }
    } catch(e) {}
})();
