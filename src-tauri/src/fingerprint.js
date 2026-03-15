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

    // ── toString hardening ──────────────────────────────────────────────────
    // override Function.prototype.toString to intercept all toString calls
    // including .bind(), Reflect.apply, and iframe cross-realm calls
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
    // patch every iframe's Function.prototype.toString + navigator spoofs
    function patchIframeWindow(win) {
        try {
            var origTS = win.Function.prototype.toString;
            win.Function.prototype.toString = function() {
                if (_hardenedSet.has(this)) return ns;
                return origTS.call(this);
            };
            _hardenedSet.add(win.Function.prototype.toString);
            win.Function.prototype.toLocaleString = win.Function.prototype.toString;
        } catch(e) {}
    }

    // hook appendChild/insertBefore/append to catch iframe insertion at earliest point
    var _origAppendChild = Node.prototype.appendChild;
    var _origInsertBefore = Node.prototype.insertBefore;
    var _origAppend = Element.prototype.append;
    var _origPrepend = Element.prototype.prepend;

    function maybePatchiframe(el) {
        if (el && el.tagName === 'IFRAME' && el.contentWindow && !el.__bushidoFP) {
            el.__bushidoFP = true;
            patchIframeWindow(el.contentWindow);
            // also re-patch after iframe loads (src/srcdoc may reload contentWindow)
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

    // hook srcdoc and src setters to patch before content loads
    try {
        var srcdocDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
        if (srcdocDesc && srcdocDesc.set) {
            var origSrcdocSet = srcdocDesc.set;
            Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
                set: function(val) {
                    var self = this;
                    origSrcdocSet.call(this, val);
                    // microtask fires before macrotask, earliest post-set timing
                    Promise.resolve().then(function() {
                        if (self.contentWindow) { self.__bushidoFP = false; maybePatchiframe(self); }
                    });
                },
                get: srcdocDesc.get,
                configurable: true
            });
        }
    } catch(e) {}

    // patch existing iframes
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

    // ── spoofed values (used by multiple sections) ──────────────────────────
    var spoofedUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    var spoofedHWC = 8;
    var spoofedDM = 8;
    var spoofedMTP = 0;
    var spoofedPlatform = 'Win32';
    var spoofedLangs = ['en-US', 'en'];

    // ── navigator props ─────────────────────────────────────────────────────
    // track which (object, prop) pairs we spoofed for getOwnPropertyDescriptor hardening
    var _spoofedProps = [];
    function spoofProp(obj, prop, value, enumerable) {
        try {
            Object.defineProperty(obj, prop, { get: function() { return value; }, configurable: false });
            _spoofedProps.push({ obj: obj, prop: prop, value: value, enumerable: enumerable !== false });
        } catch(e) {}
    }

    spoofProp(navigator, 'doNotTrack', '1');
    spoofProp(navigator, 'globalPrivacyControl', true);
    // spoof plugins to match Chrome 131 (empty = fingerprint red flag)
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
    // make spoofed properties look like native data properties, not getters
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
        // also patch Reflect.getOwnPropertyDescriptor
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

    // ── webgl vendor/renderer + parameter consistency ───────────────────────
    try {
        var gpus = [
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)'],
            ['Google Inc. (Intel)', 'ANGLE (Intel, Intel(R) HD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)'],
        ];
        var gi = Math.floor(rng() * gpus.length);
        var sv = gpus[gi][0], sr = gpus[gi][1];

        // Intel iGPU parameter specs (consistent with spoofed renderer)
        var intelParams = {};
        intelParams[0x0D33] = 16384;  // MAX_TEXTURE_SIZE
        intelParams[0x0D36] = new Int32Array([16384, 16384]); // MAX_VIEWPORT_DIMS
        intelParams[0x8D42] = 16384;  // MAX_RENDERBUFFER_SIZE
        intelParams[0x8869] = 16;     // MAX_VERTEX_ATTRIBS
        intelParams[0x8DFB] = 16;     // MAX_VERTEX_TEXTURE_IMAGE_UNITS
        intelParams[0x8872] = 16;     // MAX_TEXTURE_IMAGE_UNITS
        intelParams[0x8B4C] = 1024;   // MAX_VERTEX_UNIFORM_VECTORS
        intelParams[0x8B49] = 256;    // MAX_FRAGMENT_UNIFORM_VECTORS
        intelParams[0x8B4B] = 15;     // MAX_VARYING_VECTORS

        function patchGetParameter(proto, origFn) {
            proto.getParameter = function(p) {
                if (p === 37445) return sv;   // UNMASKED_VENDOR_WEBGL
                if (p === 37446) return sr;   // UNMASKED_RENDERER_WEBGL
                if (intelParams[p] !== undefined) return intelParams[p];
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

        // shader precision normalization
        var origPrec = WebGLRenderingContext.prototype.getShaderPrecisionFormat;
        WebGLRenderingContext.prototype.getShaderPrecisionFormat = function(st, pt) {
            var r = origPrec.call(this, st, pt);
            if (!r) return r;
            return { rangeMin: r.rangeMin, rangeMax: r.rangeMax, precision: r.precision };
        };
        harden(WebGLRenderingContext.prototype, 'getShaderPrecisionFormat');
    } catch(e) {}

    // ── audio fingerprint — noise on all output paths ───────────────────────
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

    // ── timing: performance.now + Date.now clamping ─────────────────────────
    // clamp to 100μs buckets (like Tor Browser) with monotonic guarantee
    try {
        var origPN = performance.now.bind(performance);
        var origDateNow = Date.now;
        var _dateOffset = origDateNow.call(Date);
        var _perfOffset = origPN();
        var CL = 0.1; // 100μs clamp — subtle enough to not break sites, enough to defeat μs fingerprinting
        var _lastPerf = 0;

        performance.now = function() {
            var t = origPN();
            var c = Math.floor(t / CL) * CL;
            // guarantee monotonic — never return a value less than previous
            if (c <= _lastPerf) c = _lastPerf;
            _lastPerf = c;
            return c;
        };
        harden(performance, 'now');

        // clamp Date.now to match performance.now so comparison can't detect clamping
        var _lastDateNow = 0;
        Date.now = function() {
            var perf = performance.now();
            var d = Math.round(_dateOffset + (perf - _perfOffset));
            if (d <= _lastDateNow) d = _lastDateNow;
            _lastDateNow = d;
            return d;
        };
        harden(Date, 'now');

        // also clamp Date.prototype.getTime for new Date().getTime()
        var origGetTime = Date.prototype.getTime;
        Date.prototype.getTime = function() {
            var real = origGetTime.call(this);
            // only clamp if this is "now" (within 1 second of current time)
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
    // prevent stack traces from leaking WebView2/Tauri file paths
    try {
        var _origStackDesc = Object.getOwnPropertyDescriptor(Error.prototype, 'stack') ||
                             Object.getOwnPropertyDescriptor(new Error(), 'stack');
        var sanitizeStack = function(stack) {
            if (typeof stack !== 'string') return stack;
            return stack.split('\n').map(function(line) {
                // replace URLs and file paths with generic markers
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

    // ── timezone fingerprinting protection ─────────────────────────────────────
    try {
        var _origDTF = Intl.DateTimeFormat;
        var _spoofedTZ = 'America/New_York';
        var _spoofedLocale = 'en-US';
        Intl.DateTimeFormat = function() {
            var instance = _origDTF.apply(this, arguments.length ? arguments : [_spoofedLocale]);
            var _origResolved = instance.resolvedOptions.bind(instance);
            instance.resolvedOptions = function() {
                var opts = _origResolved();
                opts.timeZone = _spoofedTZ;
                opts.locale = _spoofedLocale;
                return opts;
            };
            return instance;
        };
        Intl.DateTimeFormat.prototype = _origDTF.prototype;
        Intl.DateTimeFormat.supportedLocalesOf = _origDTF.supportedLocalesOf;
        harden(Intl, 'DateTimeFormat');
    } catch(e) {}
    try {
        var _origGetTZOffset = Date.prototype.getTimezoneOffset;
        Date.prototype.getTimezoneOffset = function() {
            return -300; // EST (UTC-5) = -300 minutes
        };
        harden(Date.prototype, 'getTimezoneOffset');
    } catch(e) {}

    // ── CSS media query fingerprinting protection ────────────────────────────
    try {
        var _origMatchMedia = window.matchMedia;
        window.matchMedia = function(query) {
            var normalized = query.replace(/\s+/g, ' ').trim().toLowerCase();
            if (normalized.indexOf('prefers-color-scheme') !== -1) {
                var light = normalized.indexOf('light') !== -1;
                var result = _origMatchMedia.call(window, query);
                return Object.create(result, {
                    matches: { get: function() { return light; }, configurable: true }
                });
            }
            if (normalized.indexOf('prefers-reduced-motion') !== -1) {
                var noPref = normalized.indexOf('no-preference') !== -1;
                var result = _origMatchMedia.call(window, query);
                return Object.create(result, {
                    matches: { get: function() { return noPref; }, configurable: true }
                });
            }
            if (normalized.indexOf('prefers-contrast') !== -1) {
                var noPref = normalized.indexOf('no-preference') !== -1;
                var result = _origMatchMedia.call(window, query);
                return Object.create(result, {
                    matches: { get: function() { return noPref; }, configurable: true }
                });
            }
            return _origMatchMedia.call(window, query);
        };
        harden(window, 'matchMedia');
    } catch(e) {}

    // ── Worker/SharedWorker interception ─────────────────────────────────────
    // Workers have a clean global scope — inject navigator spoofs before real script runs
    try {
        var _origWorker = window.Worker;
        var _origSharedWorker = window.SharedWorker;

        var workerPreamble = '(' + (function() {
            try { Object.defineProperty(navigator, 'hardwareConcurrency', { get: function() { return __HWC__; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'deviceMemory', { get: function() { return __DM__; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'platform', { get: function() { return '__PLAT__'; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'language', { get: function() { return 'en-US'; }, configurable: false }); } catch(e) {}
            try { Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US','en']; }, configurable: false }); } catch(e) {}
            try {
                var _origDTF = Intl.DateTimeFormat;
                Intl.DateTimeFormat = function() {
                    var instance = _origDTF.apply(this, arguments.length ? arguments : ['en-US']);
                    var _origResolved = instance.resolvedOptions.bind(instance);
                    instance.resolvedOptions = function() {
                        var opts = _origResolved();
                        opts.timeZone = 'America/New_York';
                        opts.locale = 'en-US';
                        return opts;
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
                            // add subtle noise to prevent canvas fingerprinting via OffscreenCanvas
                            try {
                                var ctx = this.getContext('2d');
                                if (ctx) {
                                    var w = this.width, h = this.height;
                                    if (w > 0 && h > 0 && w <= 4096 && h <= 4096) {
                                        var img = ctx.getImageData(0, 0, w, h);
                                        var d = img.data;
                                        for (var i = 0; i < d.length; i += 4) {
                                            d[i] ^= (Math.random() > 0.5 ? 1 : 0);
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
            .replace('__HWC__', String(spoofedHWC))
            .replace('__DM__', String(spoofedDM))
            .replace('__PLAT__', spoofedPlatform)
        + ')();\n';

        window.Worker = function(scriptURL, options) {
            // handle blob URLs, data URLs, and regular URLs
            if (typeof scriptURL === 'string') {
                var blobCode = workerPreamble + 'importScripts(' + JSON.stringify(scriptURL) + ');\n';
                var blob = new Blob([blobCode], { type: 'application/javascript' });
                var blobURL = URL.createObjectURL(blob);
                var w = new _origWorker(blobURL, options);
                // clean up blob URL after worker starts
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
})();
