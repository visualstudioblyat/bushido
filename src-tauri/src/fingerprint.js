(function() {
    'use strict';
    if (window.__bushidoFingerprint) return;
    Object.defineProperty(window, '__bushidoFingerprint', { value: true, writable: false, configurable: false });

    // ── FIX #1: Per-site PRNG seed (research/17 Attack 20, research/18 D.1) ──
    // Derive seed from domain so each site gets different canvas/WebGL/audio noise.
    // Prevents cross-site fingerprint linkage (same hash on site-A and site-B).
    // Session salt still provides per-session randomization within a domain.
    var sessionSalt = Math.floor(Math.random() * 0xFFFFFFFF) >>> 0;
    var domain = '';
    try { domain = window.location.hostname || ''; } catch(e) {}
    var domainHash = 0;
    for (var ci = 0; ci < domain.length; ci++) {
        domainHash = ((domainHash << 5) - domainHash + domain.charCodeAt(ci)) | 0;
    }
    var seed = (sessionSalt ^ (domainHash >>> 0) ^ 0x9E3779B9) >>> 0;
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

    // ── toString hardening ──────────────────────────────────────────────────
    var _origFPTS = Function.prototype.toString;
    var _hardenedSet = new WeakSet();
    Function.prototype.toString = function() {
        if (_hardenedSet.has(this)) {
            var name = this.name || '';
            return 'function ' + name + '() { [native code] }';
        }
        return _origFPTS.call(this);
    };
    _hardenedSet.add(Function.prototype.toString);
    Function.prototype.toLocaleString = Function.prototype.toString;

    function harden(obj, prop) {
        try {
            var fn = typeof prop === 'string' ? obj[prop] : obj;
            if (fn && typeof fn === 'function') {
                _hardenedSet.add(fn);
            }
        } catch(e) {}
    }

    // ── iframe bypass protection ────────────────────────────────────────────
    function patchIframeWindow(win) {
        try {
            var origTS = win.Function.prototype.toString;
            win.Function.prototype.toString = function() {
                if (_hardenedSet.has(this)) {
                    var name = this.name || '';
                    return 'function ' + name + '() { [native code] }';
                }
                return origTS.call(this);
            };
            _hardenedSet.add(win.Function.prototype.toString);
            win.Function.prototype.toLocaleString = win.Function.prototype.toString;
        } catch(e) {}
    }

    var _origAppendChild = Node.prototype.appendChild;
    var _origInsertBefore = Node.prototype.insertBefore;
    var _origAppend = Element.prototype.append;
    var _origPrepend = Element.prototype.prepend;

    function maybePatchiframe(el) {
        if (el && el.tagName === 'IFRAME' && el.contentWindow && !el.__bushidoFP) {
            el.__bushidoFP = true;
            patchIframeWindow(el.contentWindow);
            el.addEventListener('load', function() {
                try { if (el.contentWindow) patchIframeWindow(el.contentWindow); } catch(e) {}
            });
        }
    }

    Node.prototype.appendChild = function(child) {
        var result = _origAppendChild.call(this, child);
        maybePatchiframe(child);
        return result;
    };
    _hardenedSet.add(Node.prototype.appendChild);

    Node.prototype.insertBefore = function(newNode, refNode) {
        var result = _origInsertBefore.call(this, newNode, refNode);
        maybePatchiframe(newNode);
        return result;
    };
    _hardenedSet.add(Node.prototype.insertBefore);

    if (_origAppend) {
        Element.prototype.append = function() {
            _origAppend.apply(this, arguments);
            for (var i = 0; i < arguments.length; i++) maybePatchiframe(arguments[i]);
        };
        _hardenedSet.add(Element.prototype.append);
    }
    if (_origPrepend) {
        Element.prototype.prepend = function() {
            _origPrepend.apply(this, arguments);
            for (var i = 0; i < arguments.length; i++) maybePatchiframe(arguments[i]);
        };
        _hardenedSet.add(Element.prototype.prepend);
    }

    try {
        var srcdocDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
        if (srcdocDesc && srcdocDesc.set) {
            var origSrcdocSet = srcdocDesc.set;
            Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
                set: function(val) {
                    var self = this;
                    origSrcdocSet.call(this, val);
                    Promise.resolve().then(function() {
                        if (self.contentWindow) { self.__bushidoFP = false; maybePatchiframe(self); }
                    });
                },
                get: srcdocDesc.get,
                configurable: true
            });
        }
    } catch(e) {}

    try {
        var existingFrames = document.querySelectorAll('iframe');
        for (var i = 0; i < existingFrames.length; i++) maybePatchiframe(existingFrames[i]);
    } catch(e) {}

    // ── referrer policy ─────────────────────────────────────────────────────
    try {
        var meta = document.createElement('meta');
        meta.setAttribute('name', 'referrer');
        meta.setAttribute('content', 'origin');
        (document.head || document.documentElement).appendChild(meta);
    } catch(e) {}

    // ── spoofed values ──────────────────────────────────────────────────────
    var spoofedUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    var spoofedHWC = 8;
    var spoofedDM = 8;
    var spoofedMTP = 0;
    var spoofedPlatform = 'Win32';
    var spoofedLangs = ['en-US', 'en'];

    // ── navigator props ─────────────────────────────────────────────────────
    var _spoofedProps = [];
    function spoofProp(obj, prop, value, enumerable) {
        try {
            Object.defineProperty(obj, prop, { get: function() { return value; }, configurable: false });
            _spoofedProps.push({ obj: obj, prop: prop, value: value, enumerable: enumerable !== false });
        } catch(e) {}
    }

    spoofProp(navigator, 'doNotTrack', '1');
    spoofProp(navigator, 'globalPrivacyControl', true);
    try {
        var fakePlugin = function(name, desc, fname) {
            return { name: name, description: desc, filename: fname, length: 1, item: function() { return null; }, namedItem: function() { return null; } };
        };
        var fakePlugins = [
            fakePlugin('PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
            fakePlugin('Chrome PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
            fakePlugin('Chromium PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
            fakePlugin('Microsoft Edge PDF Viewer', 'Portable Document Format', 'internal-pdf-viewer'),
            fakePlugin('WebKit built-in PDF', 'Portable Document Format', 'internal-pdf-viewer'),
        ];
        fakePlugins.item = function(i) { return fakePlugins[i] || null; };
        fakePlugins.namedItem = function(n) { for (var i = 0; i < fakePlugins.length; i++) if (fakePlugins[i].name === n) return fakePlugins[i]; return null; };
        fakePlugins.refresh = function() {};
        Object.defineProperty(navigator, 'plugins', { get: function() { return fakePlugins; }, configurable: false });
        var fakeMimes = [{ type: 'application/pdf', description: 'Portable Document Format', suffixes: 'pdf', enabledPlugin: fakePlugins[0] }];
        fakeMimes.item = function(i) { return fakeMimes[i] || null; };
        fakeMimes.namedItem = function(n) { for (var i = 0; i < fakeMimes.length; i++) if (fakeMimes[i].type === n) return fakeMimes[i]; return null; };
        Object.defineProperty(navigator, 'mimeTypes', { get: function() { return fakeMimes; }, configurable: false });
    } catch(e) {}
    try { if (navigator.getBattery) navigator.getBattery = undefined; } catch(e) {}
    spoofProp(navigator, 'language', 'en-US');
    spoofProp(navigator, 'languages', spoofedLangs);
    spoofProp(navigator, 'platform', spoofedPlatform);
    spoofProp(navigator, 'connection', undefined);
    try { Object.defineProperty(navigator, 'mozConnection', { get: function() { return undefined; }, configurable: false }); } catch(e) {}
    try { Object.defineProperty(navigator, 'webkitConnection', { get: function() { return undefined; }, configurable: false }); } catch(e) {}
    spoofProp(navigator, 'webdriver', false);
    spoofProp(navigator, 'deviceMemory', spoofedDM);
    spoofProp(navigator, 'maxTouchPoints', spoofedMTP);
    spoofProp(navigator, 'pdfViewerEnabled', true);
    spoofProp(navigator, 'cookieEnabled', true);
    spoofProp(navigator, 'hardwareConcurrency', spoofedHWC);
    spoofProp(navigator, 'vendor', 'Google Inc.');
    spoofProp(navigator, 'appVersion', '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
    spoofProp(navigator, 'userAgent', spoofedUA);
    spoofProp(navigator, 'productSub', '20030107');
    spoofProp(navigator, 'vendorSub', '');

    // screen normalization
    spoofProp(screen, 'width', 1920);
    spoofProp(screen, 'height', 1080);
    spoofProp(screen, 'availWidth', 1920);
    spoofProp(screen, 'availHeight', 1040);
    spoofProp(screen, 'availLeft', 0);
    spoofProp(screen, 'availTop', 0);
    spoofProp(screen, 'colorDepth', 24);
    spoofProp(screen, 'pixelDepth', 24);
    spoofProp(window, 'devicePixelRatio', 1);

    // ── Object.getOwnPropertyDescriptor hardening ───────────────────────────
    try {
        var _origGOPD = Object.getOwnPropertyDescriptor;
        Object.getOwnPropertyDescriptor = function(obj, prop) {
            for (var i = 0; i < _spoofedProps.length; i++) {
                var sp = _spoofedProps[i];
                if (sp.obj === obj && sp.prop === prop) {
                    return { value: sp.value, writable: false, enumerable: sp.enumerable, configurable: false };
                }
            }
            return _origGOPD.call(Object, obj, prop);
        };
        _hardenedSet.add(Object.getOwnPropertyDescriptor);
        if (typeof Reflect !== 'undefined' && Reflect.getOwnPropertyDescriptor) {
            Reflect.getOwnPropertyDescriptor = function(obj, prop) {
                return Object.getOwnPropertyDescriptor(obj, prop);
            };
            _hardenedSet.add(Reflect.getOwnPropertyDescriptor);
        }
    } catch(e) {}

    // ── canvas fingerprint noise ────────────────────────────────────────────
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

    // ── FIX #6: OffscreenCanvas noise on main thread (research/07 FP-Scanner) ──
    // FP-Scanner checks Canvas vs OffscreenCanvas hash consistency.
    // Worker OffscreenCanvas is patched in the worker preamble; main thread was missing.
    try {
        if (typeof OffscreenCanvas !== 'undefined') {
            var origOCConvertToBlob = OffscreenCanvas.prototype.convertToBlob;
            if (origOCConvertToBlob) {
                OffscreenCanvas.prototype.convertToBlob = function() {
                    try {
                        var ctx = this.getContext('2d');
                        if (ctx) {
                            var w = this.width, h = this.height;
                            if (w > 0 && h > 0 && w <= 4096 && h <= 4096) {
                                var img = ctx.getImageData(0, 0, w, h);
                                var d = img.data;
                                for (var i = 0; i < d.length; i += 4) {
                                    d[i] ^= (rng() > 0.5 ? 1 : 0);
                                    d[i+1] ^= (rng() > 0.75 ? 1 : 0);
                                }
                                ctx.putImageData(img, 0, 0);
                            }
                        }
                    } catch(e2) {}
                    return origOCConvertToBlob.apply(this, arguments);
                };
                harden(OffscreenCanvas.prototype, 'convertToBlob');
            }
        }
    } catch(e) {}

    // ── FIX #7: Expanded GPU pool (research/05 entropy, research/07 FP-Scanner) ──
    // 4 GPUs = 2 bits entropy. 16 GPUs = 4 bits. Harder to cluster users.
    // Added AMD Radeon, Intel Iris, and more UHD variants with matching params.
    try {
        var gpuPool = [
            // Intel UHD series (most common on laptops)
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            // Intel HD series (older but still common)
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            // Intel Iris (higher-end laptops)
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Plus Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) Iris(R) Graphics 6100 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'intel'],
            // AMD Radeon integrated (common on AMD laptops/desktops)
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'amd'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'amd'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon RX Vega 8 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'amd'],
            ['Google Inc. (AMD)', 'ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'amd'],
            // NVIDIA (common discrete GPUs)
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'nvidia'],
            ['Google Inc. (NVIDIA)', 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'nvidia'],
        ];

        var gpuParams = {
            intel: {
                0x0D33: 16384, 0x0D36: new Int32Array([16384, 16384]), 0x8D42: 16384,
                0x8869: 16, 0x8DFB: 16, 0x8872: 16,
                0x8B4C: 1024, 0x8B49: 256, 0x8B4B: 15
            },
            amd: {
                0x0D33: 16384, 0x0D36: new Int32Array([16384, 16384]), 0x8D42: 16384,
                0x8869: 16, 0x8DFB: 16, 0x8872: 16,
                0x8B4C: 4096, 0x8B49: 1024, 0x8B4B: 32
            },
            nvidia: {
                0x0D33: 32768, 0x0D36: new Int32Array([32768, 32768]), 0x8D42: 32768,
                0x8869: 16, 0x8DFB: 32, 0x8872: 32,
                0x8B4C: 4096, 0x8B49: 1024, 0x8B4B: 32
            }
        };

        var gi = Math.floor(rng() * gpuPool.length);
        var sv = gpuPool[gi][0], sr = gpuPool[gi][1];
        var selectedParams = gpuParams[gpuPool[gi][2]];

        function patchGetParameter(proto, origFn) {
            proto.getParameter = function(p) {
                if (p === 37445) return sv;   // UNMASKED_VENDOR_WEBGL
                if (p === 37446) return sr;   // UNMASKED_RENDERER_WEBGL
                if (selectedParams[p] !== undefined) return selectedParams[p];
                return origFn.call(this, p);
            };
            harden(proto, 'getParameter');
        }

        var origGP = WebGLRenderingContext.prototype.getParameter;
        patchGetParameter(WebGLRenderingContext.prototype, origGP);

        if (typeof WebGL2RenderingContext !== 'undefined') {
            var origGP2 = WebGL2RenderingContext.prototype.getParameter;
            patchGetParameter(WebGL2RenderingContext.prototype, origGP2);
        }

        var origPrec = WebGLRenderingContext.prototype.getShaderPrecisionFormat;
        WebGLRenderingContext.prototype.getShaderPrecisionFormat = function(st, pt) {
            var r = origPrec.call(this, st, pt);
            if (!r) return r;
            return { rangeMin: r.rangeMin, rangeMax: r.rangeMax, precision: r.precision };
        };
        harden(WebGLRenderingContext.prototype, 'getShaderPrecisionFormat');
    } catch(e) {}

    // ── audio fingerprint noise ─────────────────────────────────────────────
    // Per-call noise from PRNG (not a cached constant — research/07 consistency)
    function audioNoise() { return (rng() - 0.5) * 0.01; }
    try {
        var origGF = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = function(arr) {
            origGF.call(this, arr);
            var n = audioNoise();
            for (var i = 0; i < arr.length; i++) arr[i] += n;
        };
        harden(AnalyserNode.prototype, 'getFloatFrequencyData');
    } catch(e) {}
    try {
        var origGFT = AnalyserNode.prototype.getFloatTimeDomainData;
        AnalyserNode.prototype.getFloatTimeDomainData = function(arr) {
            origGFT.call(this, arr);
            var n = audioNoise();
            for (var i = 0; i < arr.length; i++) arr[i] += n;
        };
        harden(AnalyserNode.prototype, 'getFloatTimeDomainData');
    } catch(e) {}
    try {
        var origSR = OfflineAudioContext.prototype.startRendering;
        OfflineAudioContext.prototype.startRendering = function() {
            return origSR.call(this).then(function(buf) {
                try {
                    var origGCD = buf.getChannelData.bind(buf);
                    buf.getChannelData = function(ch) {
                        var d = origGCD(ch);
                        var n = audioNoise();
                        for (var i = 0; i < d.length; i++) d[i] += n;
                        return d;
                    };
                } catch(e) {}
                return buf;
            });
        };
        harden(OfflineAudioContext.prototype, 'startRendering');
    } catch(e) {}
    try {
        var origABGCD = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(ch) {
            var d = origABGCD.call(this, ch);
            if (!this.__bushidoNoised) {
                this.__bushidoNoised = true;
                var n = audioNoise();
                for (var i = 0; i < d.length; i++) d[i] += n;
            }
            return d;
        };
        harden(AudioBuffer.prototype, 'getChannelData');
    } catch(e) {}

    // ── timing clamping ─────────────────────────────────────────────────────
    try {
        var origPN = performance.now.bind(performance);
        var origDateNow = Date.now;
        var _dateOffset = origDateNow.call(Date);
        var _perfOffset = origPN();
        var CL = 0.1;
        var _lastPerf = 0;

        performance.now = function() {
            var t = origPN();
            var c = Math.floor(t / CL) * CL;
            if (c <= _lastPerf) c = _lastPerf;
            _lastPerf = c;
            return c;
        };
        harden(performance, 'now');

        var _lastDateNow = 0;
        Date.now = function() {
            var perf = performance.now();
            var d = Math.round(_dateOffset + (perf - _perfOffset));
            if (d <= _lastDateNow) d = _lastDateNow;
            _lastDateNow = d;
            return d;
        };
        harden(Date, 'now');

        var origGetTime = Date.prototype.getTime;
        Date.prototype.getTime = function() {
            var real = origGetTime.call(this);
            var now = origDateNow.call(Date);
            if (Math.abs(real - now) < 1000) {
                return Date.now();
            }
            return real;
        };
        harden(Date.prototype, 'getTime');
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

    // ── error stack trace sanitization ───────────────────────────────────────
    try {
        var _origStackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack') ||
                             Object.getOwnPropertyDescriptor(new Error(), 'stack');
        var sanitizeStack = function(stack) {
            if (typeof stack !== 'string') return stack;
            return stack.split('\n').map(function(line) {
                return line
                    .replace(/https?:\/\/[^\s)]+/g, 'https://[redacted]')
                    .replace(/\([^)]*\.js:\d+:\d+\)/g, '([native code])')
                    .replace(/at\s+.*\.js:\d+:\d+/g, 'at [native code]');
            }).join('\n');
        };

        Object.defineProperty(Error.prototype, 'stack', {
            get: function() {
                var val = this.__bushidoRealStack;
                return sanitizeStack(val);
            },
            set: function(val) {
                this.__bushidoRealStack = val;
            },
            configurable: true,
            enumerable: false
        });
    } catch(e) {}

    // ── api stubs ───────────────────────────────────────────────────────────
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

    // ── timezone fingerprinting protection ──────────────────────────────────
    // FIX #8: Ported Shadey's improved timezone handling — injects TZ into
    // constructor args (not just resolvedOptions), patches Date.toString/
    // toTimeString/toDateString, fixes getTimezoneOffset sign (was -300, must be 300)
    try {
        var _origDTF = Intl.DateTimeFormat;
        var _spoofedTZ = 'America/New_York';
        var _spoofedLocale = 'en-US';

        Intl.DateTimeFormat = function(locales, options) {
            var opts = Object.assign({}, options || {});
            if (!opts.timeZone) {
                opts.timeZone = _spoofedTZ;
            }
            if (!locales) locales = _spoofedLocale;
            var instance = new _origDTF(locales, opts);
            var _origResolved = instance.resolvedOptions.bind(instance);
            instance.resolvedOptions = function() {
                var r = _origResolved();
                r.timeZone = _spoofedTZ;
                r.locale = _spoofedLocale;
                return r;
            };
            return instance;
        };
        Intl.DateTimeFormat.prototype = _origDTF.prototype;
        Intl.DateTimeFormat.supportedLocalesOf = _origDTF.supportedLocalesOf;
        Object.defineProperty(Intl.DateTimeFormat, Symbol.hasInstance, {
            value: function(inst) { return inst instanceof _origDTF; }
        });
        harden(Intl, 'DateTimeFormat');
    } catch(e) {}
    try {
        // FIX #8b: getTimezoneOffset — EST=300, EDT=240 (DST-aware)
        // Was hardcoded -300 (wrong sign AND no DST). research/11 documents this.
        Date.prototype.getTimezoneOffset = function() {
            // Check if this date falls in DST for America/New_York
            try {
                var formatter = new _origDTF('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' });
                var parts = formatter.formatToParts(this);
                for (var i = 0; i < parts.length; i++) {
                    if (parts[i].type === 'timeZoneName') {
                        return parts[i].value === 'EDT' ? 240 : 300;
                    }
                }
            } catch(e2) {}
            return 300; // fallback to EST
        };
        harden(Date.prototype, 'getTimezoneOffset');

        // Date.toString: reconstruct with spoofed timezone
        var _origDateToString = Date.prototype.toString;
        Date.prototype.toString = function() {
            try {
                var d = this;
                var formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: 'America/New_York',
                    weekday: 'short', year: 'numeric', month: 'short', day: '2-digit',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                    hour12: false, timeZoneName: 'long'
                });
                var parts = formatter.formatToParts(d);
                var get = function(type) {
                    for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
                    return '';
                };
                // Dynamic offset: EST=-0500, EDT=-0400 (Intl handles DST)
                var tzName = get('timeZoneName') || 'Eastern Standard Time';
                var isDST = tzName.indexOf('Daylight') !== -1 || tzName.indexOf('Summer') !== -1;
                var offset = isDST ? '-0400' : '-0500';
                return get('weekday') + ' ' + get('month') + ' ' + get('day') + ' ' + get('year') + ' ' +
                       get('hour') + ':' + get('minute') + ':' + get('second') + ' GMT' + offset + ' (' + tzName + ')';
            } catch(e2) {
                return _origDateToString.call(this);
            }
        };
        harden(Date.prototype, 'toString');

        var _origTimeString = Date.prototype.toTimeString;
        Date.prototype.toTimeString = function() {
            try {
                var s = Date.prototype.toString.call(this);
                return s.split(' ').slice(4).join(' ');
            } catch(e2) {
                return _origTimeString.call(this);
            }
        };
        harden(Date.prototype, 'toTimeString');

        var _origDateString = Date.prototype.toDateString;
        Date.prototype.toDateString = function() {
            try {
                var s = Date.prototype.toString.call(this);
                return s.split(' ').slice(0, 4).join(' ');
            } catch(e2) {
                return _origDateString.call(this);
            }
        };
        harden(Date.prototype, 'toDateString');
    } catch(e) {}

    // ── CSS media query protection ──────────────────────────────────────────
    // Uses Object.defineProperty on the real result (not Object.create which broke YouTube)
    try {
        var _origMatchMedia = window.matchMedia;
        window.matchMedia = function(query) {
            var result = _origMatchMedia.call(window, query);
            var normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
            if (normalized.indexOf('prefers-color-scheme') !== -1) {
                var light = normalized.indexOf('light') !== -1;
                try { Object.defineProperty(result, 'matches', { get: function() { return light; }, configurable: true }); } catch(e2) {}
            } else if (normalized.indexOf('prefers-reduced-motion') !== -1) {
                var noPref = normalized.indexOf('no-preference') !== -1;
                try { Object.defineProperty(result, 'matches', { get: function() { return noPref; }, configurable: true }); } catch(e2) {}
            } else if (normalized.indexOf('prefers-contrast') !== -1) {
                var noPref2 = normalized.indexOf('no-preference') !== -1;
                try { Object.defineProperty(result, 'matches', { get: function() { return noPref2; }, configurable: true }); } catch(e2) {}
            }
            return result;
        };
        harden(window, 'matchMedia');
    } catch(e) {}

    // ── FIX #2: Font enumeration protection (research/13, research/18 C.1) ──
    // Sites can enumerate installed fonts via document.fonts.check() and FontFaceSet.
    // Corporate/custom fonts reveal identity (~7-10 bits entropy).
    // Allow only web-safe system fonts; block detection of exotic fonts.
    try {
        if (document.fonts && document.fonts.check) {
            var webSafeFonts = [
                'arial', 'helvetica', 'times new roman', 'times', 'courier new', 'courier',
                'verdana', 'georgia', 'palatino', 'garamond', 'bookman', 'trebuchet ms',
                'arial black', 'impact', 'comic sans ms', 'lucida sans unicode', 'tahoma',
                'lucida console', 'monaco', 'system-ui', 'segoe ui', '-apple-system',
                'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
            ];

            var origFontsCheck = document.fonts.check.bind(document.fonts);
            document.fonts.check = function(font, text) {
                // parse font family from the font shorthand (e.g. "16px 'Fira Code'")
                var familyMatch = font.match(/['"](.*?)['"]/);
                if (familyMatch) {
                    var family = familyMatch[1].toLowerCase();
                    var isSafe = false;
                    for (var i = 0; i < webSafeFonts.length; i++) {
                        if (family === webSafeFonts[i]) { isSafe = true; break; }
                    }
                    if (!isSafe) return false; // pretend exotic font is not installed
                }
                return origFontsCheck(font, text);
            };
            harden(document.fonts, 'check');

            // Block FontFaceSet iteration (forEach, entries, values)
            var emptyIterator = function() {
                return { next: function() { return { done: true, value: undefined }; }, [Symbol.iterator]: function() { return this; } };
            };
            try {
                if (document.fonts.values) {
                    document.fonts.values = function() { return emptyIterator(); };
                    harden(document.fonts, 'values');
                }
                if (document.fonts.entries) {
                    document.fonts.entries = function() { return emptyIterator(); };
                    harden(document.fonts, 'entries');
                }
                if (document.fonts.forEach) {
                    document.fonts.forEach = function() {};
                    harden(document.fonts, 'forEach');
                }
            } catch(e2) {}
        }
    } catch(e) {}

    // ── FIX #3: WebRTC protection moved here (research/18 C.2) ──────────────
    // Was in content_blocker.js, gated behind ad_blocker flag.
    // WebRTC IP leak protection must be independent of ad blocking.
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
            if (origRTC.generateCertificate) {
                wrappedRTC.generateCertificate = origRTC.generateCertificate;
            }
            window.RTCPeerConnection = wrappedRTC;
            _hardenedSet.add(window.RTCPeerConnection);
            if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = wrappedRTC;
        }
    } catch(e) {}

    // ── Worker/SharedWorker interception ─────────────────────────────────────
    // FIX: Pass PRNG seed to worker so OffscreenCanvas noise uses same
    // xorshift128+ as main thread (was using Math.random — inconsistent)
    try {
        var _origWorker = window.Worker;
        var _origSharedWorker = window.SharedWorker;

        var workerPreamble = '(' + (function() {
            // xorshift128+ PRNG in worker (same algorithm as main thread)
            var ws0 = __SEED__ ^ 0xDEADBEEF, ws1 = __SEED__ ^ 0xCAFEBABE;
            // Advance PRNG past main thread's position to avoid correlation
            for (var wi = 0; wi < 1000; wi++) { var wa = ws0, wb = ws1; ws0 = wb; wa ^= (wa << 23) | 0; wa ^= wa >>> 17; wa ^= wb; wa ^= wb >>> 26; ws1 = wa; }
            function wrng() {
                var a = ws0, b = ws1; ws0 = b; a ^= (a << 23) | 0; a ^= a >>> 17; a ^= b; a ^= b >>> 26; ws1 = a;
                return ((a + b) >>> 0) / 0xFFFFFFFF;
            }
            try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: function() { return __HWC__; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'deviceMemory', { get: function() { return __DM__; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'platform', { get: function() { return '__PLAT__'; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'language', { get: function() { return 'en-US'; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US','en']; }, configurable: false }); } catch(e) {}
            try {
                var _origDTF = Intl.DateTimeFormat;
                Intl.DateTimeFormat = function(locales, options) {
                    var opts = Object.assign({}, options || {});
                    if (!opts.timeZone) opts.timeZone = 'America/New_York';
                    if (!locales) locales = 'en-US';
                    var instance = new _origDTF(locales, opts);
                    var _origResolved = instance.resolvedOptions.bind(instance);
                    instance.resolvedOptions = function() {
                        var r = _origResolved();
                        r.timeZone = 'America/New_York';
                        r.locale = 'en-US';
                        return r;
                    };
                    return instance;
                };
                Intl.DateTimeFormat.prototype = _origDTF.prototype;
                Intl.DateTimeFormat.supportedLocalesOf = _origDTF.supportedLocalesOf;
            } catch(e) {}
            try {
                if (typeof OffscreenCanvas !== 'undefined') {
                    var origCTB = OffscreenCanvas.prototype.convertToBlob;
                    if (origCTB) {
                        OffscreenCanvas.prototype.convertToBlob = function() {
                            try {
                                var ctx = this.getContext('2d');
                                if (ctx) {
                                    var w = this.width, h = this.height;
                                    if (w > 0 && h > 0 && w <= 4096 && h <= 4096) {
                                        var img = ctx.getImageData(0, 0, w, h);
                                        var d = img.data;
                                        for (var i = 0; i < d.length; i += 4) {
                                            d[i] ^= (wrng() > 0.5 ? 1 : 0);
                                            d[i+1] ^= (wrng() > 0.75 ? 1 : 0);
                                        }
                                        ctx.putImageData(img, 0, 0);
                                    }
                                }
                            } catch(e2) {}
                            return origCTB.apply(this, arguments);
                        };
                    }
                }
            } catch(e) {}
        }).toString()
            .split('__SEED__').join(String(seed))
            .replace('__HWC__', String(spoofedHWC))
            .replace('__DM__', String(spoofedDM))
            .replace('__PLAT__', spoofedPlatform)
        + ')();\n';

        window.Worker = function(scriptURL, options) {
            if (typeof scriptURL === 'string') {
                var blobCode = workerPreamble + 'importScripts(' + JSON.stringify(scriptURL) + ');\n';
                var blob = new Blob([blobCode], { type: 'application/javascript' });
                var blobURL = URL.createObjectURL(blob);
                var w = new _origWorker(blobURL, options);
                setTimeout(function() { URL.revokeObjectURL(blobURL); }, 1000);
                return w;
            }
            return new _origWorker(scriptURL, options);
        };
        window.Worker.prototype = _origWorker.prototype;
        _hardenedSet.add(window.Worker);

        if (_origSharedWorker) {
            window.SharedWorker = function(scriptURL, options) {
                if (typeof scriptURL === 'string') {
                    var blobCode = workerPreamble + 'importScripts(' + JSON.stringify(scriptURL) + ');\n';
                    var blob = new Blob([blobCode], { type: 'application/javascript' });
                    var blobURL = URL.createObjectURL(blob);
                    var w = new _origSharedWorker(blobURL, typeof options === 'string' ? options : options);
                    setTimeout(function() { URL.revokeObjectURL(blobURL); }, 1000);
                    return w;
                }
                return new _origSharedWorker(scriptURL, options);
            };
            window.SharedWorker.prototype = _origSharedWorker.prototype;
            _hardenedSet.add(window.SharedWorker);
        }
    } catch(e) {}

    // ── navigator.userAgentData (hide Edge, spoof Chrome) ───────────────────
    try {
        var uadObj = {
            brands: [
                { brand: 'Google Chrome', version: '131' },
                { brand: 'Chromium', version: '131' },
                { brand: 'Not_A Brand', version: '24' },
            ],
            mobile: false,
            platform: 'Windows',
            getHighEntropyValues: function() {
                return Promise.resolve({
                    architecture: 'x86',
                    bitness: '64',
                    brands: [{ brand: 'Google Chrome', version: '131.0.0.0' }],
                    fullVersionList: [
                        { brand: 'Google Chrome', version: '131.0.0.0' },
                        { brand: 'Chromium', version: '131.0.0.0' },
                        { brand: 'Not_A Brand', version: '24.0.0.0' },
                    ],
                    mobile: false,
                    model: '',
                    platform: 'Windows',
                    platformVersion: '15.0.0',
                    uaFullVersion: '131.0.0.0',
                });
            },
            toJSON: function() {
                return {
                    brands: [
                        { brand: 'Google Chrome', version: '131' },
                        { brand: 'Chromium', version: '131' },
                        { brand: 'Not_A Brand', version: '24' },
                    ],
                    mobile: false,
                    platform: 'Windows',
                };
            },
        };
        harden(uadObj, 'getHighEntropyValues');
        harden(uadObj, 'toJSON');
        Object.defineProperty(navigator, 'userAgentData', {
            get: function() { return uadObj; },
            configurable: false
        });
        _spoofedProps.push({ obj: navigator, prop: 'userAgentData', value: uadObj, enumerable: true });
    } catch(e) {}

    // ── Notification.permission ─────────────────────────────────────────────
    try {
        Object.defineProperty(Notification, 'permission', { get: function() { return 'default'; } });
    } catch(e) {}

    // ── document.hasFocus (research/13 vector 3.21) ───────────────────────
    // Headless browsers return false. Must always return true.
    try {
        document.hasFocus = function() { return true; };
        harden(document, 'hasFocus');
    } catch(e) {}

    // ── window.chrome completeness (research/06, research/09) ────────────
    // Headless detection checks for window.chrome.loadTimes, window.chrome.csi
    try {
        if (!window.chrome) window.chrome = {};
        if (!window.chrome.loadTimes) {
            window.chrome.loadTimes = function() {
                return {
                    commitLoadTime: Date.now() / 1000,
                    connectionInfo: 'h2',
                    finishDocumentLoadTime: Date.now() / 1000,
                    finishLoadTime: Date.now() / 1000,
                    firstPaintAfterLoadTime: 0,
                    firstPaintTime: Date.now() / 1000,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'h2',
                    requestTime: Date.now() / 1000 - 0.3,
                    startLoadTime: Date.now() / 1000 - 0.5,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: true,
                    wasNpnNegotiated: true
                };
            };
            _hardenedSet.add(window.chrome.loadTimes);
        }
        if (!window.chrome.csi) {
            window.chrome.csi = function() {
                return { startE: Date.now(), onloadT: Date.now(), pageT: performance.now(), tran: 15 };
            };
            _hardenedSet.add(window.chrome.csi);
        }
    } catch(e) {}

    // ── screen.orientation ──────────────────────────────────────────────────
    try {
        if (!screen.orientation || !screen.orientation.type) {
            Object.defineProperty(screen, 'orientation', {
                get: function() { return { type: 'landscape-primary', angle: 0 }; },
            });
        }
    } catch(e) {}
})();
