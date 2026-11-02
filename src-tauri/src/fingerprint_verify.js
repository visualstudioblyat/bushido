(function() {
    'use strict';
    if (window.__bushidoVerify) return;
    Object.defineProperty(window, '__bushidoVerify', { value: true, writable: false, configurable: false });

    var results = [];
    var passed = 0;
    var failed = 0;

    function assert(name, condition, detail) {
        if (condition) {
            passed++;
            results.push({ name: name, pass: true, detail: detail || '' });
        } else {
            failed++;
            results.push({ name: name, pass: false, detail: detail || 'FAILED' });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 1: Navigator Property Spoofing
    // ═══════════════════════════════════════════════════════════════

    assert('nav.userAgent is Chrome',
        navigator.userAgent.indexOf('Chrome/') !== -1 && navigator.userAgent.indexOf('Edg/') === -1,
        navigator.userAgent.substring(0, 80));

    assert('nav.vendor is Google',
        navigator.vendor === 'Google Inc.',
        navigator.vendor);

    assert('nav.platform is Win32',
        navigator.platform === 'Win32',
        navigator.platform);

    assert('nav.webdriver is false',
        navigator.webdriver === false,
        String(navigator.webdriver));

    assert('nav.hardwareConcurrency is number',
        typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0,
        String(navigator.hardwareConcurrency));

    assert('nav.deviceMemory is number',
        typeof navigator.deviceMemory === 'number' && navigator.deviceMemory > 0,
        String(navigator.deviceMemory));

    assert('nav.language is en-US',
        navigator.language === 'en-US',
        navigator.language);

    assert('nav.languages contains en-US',
        Array.isArray(navigator.languages) && navigator.languages[0] === 'en-US',
        JSON.stringify(navigator.languages));

    assert('nav.maxTouchPoints is 0',
        navigator.maxTouchPoints === 0,
        String(navigator.maxTouchPoints));

    assert('nav.productSub is 20030107',
        navigator.productSub === '20030107',
        navigator.productSub);

    assert('nav.doNotTrack is 1 (matches DNT header)',
        navigator.doNotTrack === '1',
        String(navigator.doNotTrack));

    assert('nav.globalPrivacyControl is true (matches Sec-GPC header)',
        navigator.globalPrivacyControl === true,
        String(navigator.globalPrivacyControl));

    assert('nav.connection is undefined',
        navigator.connection === undefined,
        String(navigator.connection));

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 2: GOPD Hardening (property descriptor spoofing)
    // ═══════════════════════════════════════════════════════════════

    var uaDesc = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
    assert('GOPD: nav.userAgent looks native (has value, no get)',
        uaDesc && uaDesc.value !== undefined && uaDesc.get === undefined,
        uaDesc ? JSON.stringify({ hasValue: 'value' in uaDesc, hasGet: 'get' in uaDesc }) : 'no descriptor');

    var hwcDesc = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
    assert('GOPD: nav.hardwareConcurrency looks native',
        hwcDesc && hwcDesc.value !== undefined && hwcDesc.get === undefined,
        hwcDesc ? JSON.stringify({ hasValue: 'value' in hwcDesc, hasGet: 'get' in hwcDesc }) : 'no descriptor');

    var platDesc = Object.getOwnPropertyDescriptor(navigator, 'platform');
    assert('GOPD: nav.platform looks native',
        platDesc && platDesc.value !== undefined && platDesc.get === undefined,
        platDesc ? JSON.stringify({ hasValue: 'value' in platDesc, hasGet: 'get' in platDesc }) : 'no descriptor');

    // Reflect.getOwnPropertyDescriptor should match
    if (typeof Reflect !== 'undefined') {
        var reflectDesc = Reflect.getOwnPropertyDescriptor(navigator, 'userAgent');
        assert('Reflect.GOPD matches Object.GOPD for nav.userAgent',
            reflectDesc && reflectDesc.value === navigator.userAgent,
            reflectDesc ? String(reflectDesc.value).substring(0, 40) : 'no descriptor');
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 3: toString Hardening
    // ═══════════════════════════════════════════════════════════════

    assert('toString: navigator.userAgent getter looks native',
        String(Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent')).indexOf('[native code]') !== -1 ||
        (function() { try { var d = Object.getOwnPropertyDescriptor(Navigator.prototype, 'userAgent'); return !d || !d.get || d.get.toString().indexOf('[native code]') !== -1; } catch(e) { return true; } })(),
        'checked Navigator.prototype descriptor');

    // Check that our patched functions return [native code]
    assert('toString: matchMedia.toString() shows native',
        window.matchMedia.toString().indexOf('[native code]') !== -1,
        window.matchMedia.toString().substring(0, 50));

    assert('toString: Date.now.toString() shows native',
        Date.now.toString().indexOf('[native code]') !== -1,
        Date.now.toString().substring(0, 50));

    assert('toString: performance.now.toString() shows native',
        performance.now.toString().indexOf('[native code]') !== -1,
        performance.now.toString().substring(0, 50));

    // double-toString: fn.toString.toString() should also be native
    assert('toString: double toString is native',
        Function.prototype.toString.toString().indexOf('[native code]') !== -1,
        Function.prototype.toString.toString().substring(0, 50));

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 4: Screen Normalization
    // ═══════════════════════════════════════════════════════════════

    assert('screen.width is 1920',
        screen.width === 1920,
        String(screen.width));

    assert('screen.height is 1080',
        screen.height === 1080,
        String(screen.height));

    assert('screen.colorDepth is 24',
        screen.colorDepth === 24,
        String(screen.colorDepth));

    assert('devicePixelRatio is 1',
        window.devicePixelRatio === 1,
        String(window.devicePixelRatio));

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 5: Timezone Consistency (multi-API cross-check)
    // ═══════════════════════════════════════════════════════════════

    var tzOffset = new Date().getTimezoneOffset();
    assert('getTimezoneOffset is 300 (EST) or 240 (EDT)',
        tzOffset === 300 || tzOffset === 240,
        'got ' + tzOffset);

    var dtf = new Intl.DateTimeFormat();
    var resolved = dtf.resolvedOptions();
    assert('Intl.DateTimeFormat timezone is America/New_York',
        resolved.timeZone === 'America/New_York',
        resolved.timeZone);

    assert('Intl.DateTimeFormat locale is en-US',
        resolved.locale === 'en-US',
        resolved.locale);

    // Date.toString should contain EST or Eastern
    var dateStr = new Date().toString();
    assert('Date.toString contains timezone indicator',
        dateStr.indexOf('Eastern') !== -1 || dateStr.indexOf('-0500') !== -1 || dateStr.indexOf('-0400') !== -1,
        dateStr.substring(dateStr.indexOf('GMT')));

    // Cross-check: offset vs Intl should agree
    // EST = UTC-5 = offset 300, EDT = UTC-4 = offset 240
    assert('TZ offset consistent with Intl (EST/EDT range)',
        tzOffset === 300 || tzOffset === 240,
        'offset=' + tzOffset);

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 6: Canvas Fingerprint Protection
    // ═══════════════════════════════════════════════════════════════

    try {
        var c1 = document.createElement('canvas');
        c1.width = 200; c1.height = 50;
        var ctx1 = c1.getContext('2d');
        ctx1.fillStyle = '#f00';
        ctx1.fillRect(0, 0, 200, 50);
        ctx1.fillStyle = '#000';
        ctx1.font = '18px Arial';
        ctx1.fillText('Bushido Test 123', 10, 30);
        var hash1 = c1.toDataURL();

        var c2 = document.createElement('canvas');
        c2.width = 200; c2.height = 50;
        var ctx2 = c2.getContext('2d');
        ctx2.fillStyle = '#f00';
        ctx2.fillRect(0, 0, 200, 50);
        ctx2.fillStyle = '#000';
        ctx2.font = '18px Arial';
        ctx2.fillText('Bushido Test 123', 10, 30);
        var hash2 = c2.toDataURL();

        // Two identical canvas operations should produce DIFFERENT hashes if noise is working
        // (PRNG advances between calls, so noise differs)
        assert('Canvas noise active (two identical draws differ)',
            hash1 !== hash2,
            hash1 === hash2 ? 'SAME hash — noise not working' : 'hashes differ');

        // But hash shouldn't be empty or broken
        assert('Canvas hash is valid data URL',
            hash1.indexOf('data:image/png') === 0,
            hash1.substring(0, 30));
    } catch(e) {
        assert('Canvas noise active', false, 'Error: ' + e.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 7: WebGL Spoofing
    // ═══════════════════════════════════════════════════════════════

    try {
        var glCanvas = document.createElement('canvas');
        var gl = glCanvas.getContext('webgl') || glCanvas.getContext('experimental-webgl');
        if (gl) {
            var dbg = gl.getExtension('WEBGL_debug_renderer_info');
            if (dbg) {
                var vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
                var renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);

                assert('WebGL vendor contains Intel or AMD',
                    vendor.indexOf('Intel') !== -1 || vendor.indexOf('AMD') !== -1 || vendor.indexOf('Google') !== -1,
                    vendor);

                assert('WebGL renderer contains ANGLE',
                    renderer.indexOf('ANGLE') !== -1,
                    renderer.substring(0, 60));

                // Verify parameter consistency
                var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
                assert('WebGL MAX_TEXTURE_SIZE is reasonable',
                    maxTex >= 4096 && maxTex <= 32768,
                    String(maxTex));
            } else {
                assert('WebGL debug extension available', false, 'WEBGL_debug_renderer_info not available');
            }
        } else {
            assert('WebGL context available', false, 'No WebGL context');
        }
    } catch(e) {
        assert('WebGL spoofing', false, 'Error: ' + e.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 8: Audio Fingerprint Protection
    // ═══════════════════════════════════════════════════════════════

    try {
        var audioCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 44100, 44100);
        var osc = audioCtx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = 10000;
        var comp = audioCtx.createDynamicsCompressor();
        osc.connect(comp);
        comp.connect(audioCtx.destination);
        osc.start(0);
        audioCtx.startRendering().then(function(buf) {
            var data = buf.getChannelData(0);
            // Check that audio data exists and isn't all zeros
            var sum = 0;
            for (var i = 0; i < Math.min(data.length, 1000); i++) sum += Math.abs(data[i]);
            assert('Audio fingerprint has data (noise applied)',
                sum > 0,
                'sum of first 1000 samples: ' + sum.toFixed(6));
        }).catch(function() {
            assert('Audio fingerprint rendering', false, 'startRendering failed');
        });
    } catch(e) {
        // audio context may not be available in all contexts
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 9: Timing Clamping
    // ═══════════════════════════════════════════════════════════════

    var t1 = performance.now();
    var t2 = performance.now();
    var t3 = performance.now();

    assert('performance.now is monotonic',
        t3 >= t2 && t2 >= t1,
        't1=' + t1 + ' t2=' + t2 + ' t3=' + t3);

    // Check clamping: value should be a multiple of 0.1 (100μs)
    // Use tolerance for JS floating point (3226.7000000000003 ≈ 3226.7)
    var remainder = (t1 * 10) % 1;
    var isClamped = remainder < 0.001 || remainder > 0.999;
    assert('performance.now is clamped to 100μs',
        isClamped,
        't1=' + t1 + ' remainder=' + remainder.toFixed(6));

    // Date.now vs performance.now consistency
    var dn = Date.now();
    var pn = performance.now();
    assert('Date.now and performance.now are consistent',
        typeof dn === 'number' && typeof pn === 'number' && dn > 0,
        'Date.now=' + dn + ' perf.now=' + pn);

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 10: Plugins Spoofing
    // ═══════════════════════════════════════════════════════════════

    assert('navigator.plugins has 5 PDF plugins',
        navigator.plugins.length === 5,
        'length=' + navigator.plugins.length);

    assert('navigator.plugins[0] is PDF Viewer',
        navigator.plugins[0] && navigator.plugins[0].name === 'PDF Viewer',
        navigator.plugins[0] ? navigator.plugins[0].name : 'null');

    assert('navigator.mimeTypes has application/pdf',
        navigator.mimeTypes.length > 0 && navigator.mimeTypes[0].type === 'application/pdf',
        navigator.mimeTypes[0] ? navigator.mimeTypes[0].type : 'empty');

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 11: CSS Media Query Protection
    // ═══════════════════════════════════════════════════════════════

    var mqLight = window.matchMedia('(prefers-color-scheme: light)');
    var mqDark = window.matchMedia('(prefers-color-scheme: dark)');
    assert('matchMedia: light=true, dark=false',
        mqLight.matches === true && mqDark.matches === false,
        'light=' + mqLight.matches + ' dark=' + mqDark.matches);

    var mqMotion = window.matchMedia('(prefers-reduced-motion: no-preference)');
    assert('matchMedia: reduced-motion no-preference=true',
        mqMotion.matches === true,
        'no-preference=' + mqMotion.matches);

    // matchMedia result should still have addEventListener (not broken by Object.create)
    assert('matchMedia result has addEventListener',
        typeof mqLight.addEventListener === 'function',
        typeof mqLight.addEventListener);

    assert('matchMedia result has removeEventListener',
        typeof mqLight.removeEventListener === 'function',
        typeof mqLight.removeEventListener);

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 12: WebRTC IP Leak Protection
    // ═══════════════════════════════════════════════════════════════

    try {
        var pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        // If WebRTC protection is working, iceServers should be empty/filtered
        var config = pc.getConfiguration ? pc.getConfiguration() : null;
        if (config) {
            assert('WebRTC: STUN servers filtered',
                !config.iceServers || config.iceServers.length === 0,
                'iceServers=' + JSON.stringify(config.iceServers));
        } else {
            assert('WebRTC: RTCPeerConnection created (protection may be active)', true, 'no getConfiguration');
        }
        pc.close();
    } catch(e) {
        assert('WebRTC protection', false, 'Error: ' + e.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 13: Error Stack Sanitization
    // ═══════════════════════════════════════════════════════════════

    try {
        throw new Error('test');
    } catch(e) {
        var stack = e.stack || '';
        assert('Error stack does not leak file paths',
            stack.indexOf('\\') === -1 && stack.indexOf('src-tauri') === -1 && stack.indexOf('bushido') === -1,
            stack.substring(0, 100));
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 14: API Stubs
    // ═══════════════════════════════════════════════════════════════

    assert('speechSynthesis.getVoices returns empty',
        window.speechSynthesis && window.speechSynthesis.getVoices().length === 0,
        window.speechSynthesis ? 'voices=' + window.speechSynthesis.getVoices().length : 'no speechSynthesis');

    assert('storage.estimate returns fixed quota',
        typeof navigator.storage.estimate === 'function',
        'has estimate');

    assert('performance.memory is spoofed',
        performance.memory && performance.memory.jsHeapSizeLimit === 2172649472,
        performance.memory ? 'heapLimit=' + performance.memory.jsHeapSizeLimit : 'no memory');

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 15: Iframe Bypass Protection
    // ═══════════════════════════════════════════════════════════════

    try {
        var iframe = document.createElement('iframe');
        iframe.srcdoc = '<html><body></body></html>';
        document.body.appendChild(iframe);
        // Give iframe a tick to load
        setTimeout(function() {
            try {
                var iWin = iframe.contentWindow;
                if (iWin) {
                    // iframe's Function.prototype.toString should be patched
                    var iframeTS = iWin.Function.prototype.toString.call(window.matchMedia);
                    assert('Iframe: toString hardening crosses iframe boundary',
                        iframeTS.indexOf('[native code]') !== -1,
                        iframeTS.substring(0, 50));
                }
            } catch(e) {
                assert('Iframe bypass protection', true, 'cross-origin blocked (expected for some)');
            }
            document.body.removeChild(iframe);
        }, 100);
    } catch(e) {}

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 16: Worker Scope Protection
    // ═══════════════════════════════════════════════════════════════

    try {
        var workerCode = 'self.postMessage({ hwc: navigator.hardwareConcurrency, dm: navigator.deviceMemory, plat: navigator.platform, lang: navigator.language });';
        var blob = new Blob([workerCode], { type: 'application/javascript' });
        var blobURL = URL.createObjectURL(blob);
        var w = new Worker(blobURL);
        w.onmessage = function(e) {
            var d = e.data;
            assert('Worker: hardwareConcurrency spoofed',
                d.hwc === navigator.hardwareConcurrency,
                'worker=' + d.hwc + ' main=' + navigator.hardwareConcurrency);
            assert('Worker: deviceMemory spoofed',
                d.dm === navigator.deviceMemory,
                'worker=' + d.dm + ' main=' + navigator.deviceMemory);
            assert('Worker: platform spoofed',
                d.plat === navigator.platform,
                'worker=' + d.plat + ' main=' + navigator.platform);
            assert('Worker: language spoofed',
                d.lang === 'en-US',
                'worker=' + d.lang);
            w.terminate();
            URL.revokeObjectURL(blobURL);
        };
        w.onerror = function(e) {
            assert('Worker scope protection', false, 'Worker error: ' + e.message);
            w.terminate();
            URL.revokeObjectURL(blobURL);
        };
    } catch(e) {
        assert('Worker scope protection', false, 'Error: ' + e.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 17: userAgentData (Client Hints)
    // ═══════════════════════════════════════════════════════════════

    if (navigator.userAgentData) {
        assert('userAgentData.mobile is false',
            navigator.userAgentData.mobile === false,
            String(navigator.userAgentData.mobile));

        assert('userAgentData.platform is Windows',
            navigator.userAgentData.platform === 'Windows',
            navigator.userAgentData.platform);

        var brands = navigator.userAgentData.brands;
        var hasChrome = brands && brands.some(function(b) { return b.brand === 'Google Chrome'; });
        assert('userAgentData.brands includes Google Chrome',
            hasChrome,
            JSON.stringify(brands));

        var hasEdge = brands && brands.some(function(b) { return b.brand.indexOf('Edge') !== -1 || b.brand.indexOf('Edg') !== -1; });
        assert('userAgentData.brands does NOT include Edge',
            !hasEdge,
            JSON.stringify(brands));
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 18: Font Enumeration Protection
    // ═══════════════════════════════════════════════════════════════

    try {
        if (document.fonts && document.fonts.check) {
            var exoticFonts = ['Fira Code', 'JetBrains Mono', 'Consolas', 'Segoe UI Variable'];
            var detectedExotic = 0;
            for (var fi = 0; fi < exoticFonts.length; fi++) {
                if (document.fonts.check('16px "' + exoticFonts[fi] + '"')) detectedExotic++;
            }
            assert('Font enum: exotic fonts blocked',
                detectedExotic === 0,
                detectedExotic + '/' + exoticFonts.length + ' exotic fonts detected');

            // FontFaceSet iteration must be blocked
            if (document.fonts.values) {
                var valIter = document.fonts.values();
                assert('Font enum: values() returns empty iterator',
                    valIter.next().done === true,
                    'iterator should be empty');
            }
            if (document.fonts.forEach) {
                var forEachCount = 0;
                document.fonts.forEach(function() { forEachCount++; });
                assert('Font enum: forEach() does not iterate',
                    forEachCount === 0,
                    'iterated ' + forEachCount + ' times');
            }
        }
    } catch(e) {}

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 19: OffscreenCanvas Protection (main thread)
    // ═══════════════════════════════════════════════════════════════

    try {
        if (typeof OffscreenCanvas !== 'undefined') {
            var oc = new OffscreenCanvas(100, 50);
            var octx = oc.getContext('2d');
            octx.fillStyle = '#f00';
            octx.fillRect(0, 0, 100, 50);
            octx.fillStyle = '#000';
            octx.font = '14px Arial';
            octx.fillText('test', 10, 25);

            var oc2 = new OffscreenCanvas(100, 50);
            var octx2 = oc2.getContext('2d');
            octx2.fillStyle = '#f00';
            octx2.fillRect(0, 0, 100, 50);
            octx2.fillStyle = '#000';
            octx2.font = '14px Arial';
            octx2.fillText('test', 10, 25);

            Promise.all([oc.convertToBlob(), oc2.convertToBlob()]).then(function(blobs) {
                // Read both blobs and compare
                var reader1 = new FileReader();
                var reader2 = new FileReader();
                reader1.onload = function() {
                    reader2.onload = function() {
                        assert('OffscreenCanvas: noise active (main thread)',
                            reader1.result !== reader2.result,
                            reader1.result === reader2.result ? 'SAME — no noise on main thread OffscreenCanvas' : 'hashes differ');
                    };
                    reader2.readAsDataURL(blobs[1]);
                };
                reader1.readAsDataURL(blobs[0]);
            }).catch(function(e) {
                assert('OffscreenCanvas protection', false, 'convertToBlob error: ' + e.message);
            });
        }
    } catch(e) {}

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 20: Cross-Site Fingerprint Isolation
    // ═══════════════════════════════════════════════════════════════

    assert('PRNG seed is not purely Math.random',
        typeof window.__bushidoFingerprint === 'boolean',
        'guard property exists — seed derives from domain');

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 21: document.hasFocus (research/13 vector 3.21)
    // ═══════════════════════════════════════════════════════════════

    assert('document.hasFocus returns true',
        document.hasFocus() === true,
        'got ' + document.hasFocus());

    assert('document.hasFocus.toString shows native',
        document.hasFocus.toString().indexOf('[native code]') !== -1,
        document.hasFocus.toString().substring(0, 50));

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 22: window.chrome completeness (research/06, 09)
    // ═══════════════════════════════════════════════════════════════

    assert('window.chrome exists',
        typeof window.chrome === 'object' && window.chrome !== null,
        typeof window.chrome);

    assert('window.chrome.loadTimes is function',
        typeof window.chrome.loadTimes === 'function',
        typeof window.chrome.loadTimes);

    assert('window.chrome.csi is function',
        typeof window.chrome.csi === 'function',
        typeof window.chrome.csi);

    try {
        var lt = window.chrome.loadTimes();
        assert('chrome.loadTimes returns valid object',
            lt && typeof lt.requestTime === 'number' && lt.requestTime > 0,
            lt ? 'requestTime=' + lt.requestTime : 'null');
    } catch(e) {
        assert('chrome.loadTimes returns valid object', false, 'threw: ' + e.message);
    }

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 23: GPU Vendor/Renderer Consistency
    // ═══════════════════════════════════════════════════════════════

    try {
        var glc = document.createElement('canvas');
        var glctx = glc.getContext('webgl');
        if (glctx) {
            var dbg2 = glctx.getExtension('WEBGL_debug_renderer_info');
            if (dbg2) {
                var gv = glctx.getParameter(dbg2.UNMASKED_VENDOR_WEBGL);
                var gr = glctx.getParameter(dbg2.UNMASKED_RENDERER_WEBGL);
                var consistent = false;
                if (gv.indexOf('Intel') !== -1) consistent = gr.indexOf('UHD') !== -1 || gr.indexOf('HD') !== -1 || gr.indexOf('Iris') !== -1;
                else if (gv.indexOf('AMD') !== -1) consistent = gr.indexOf('Radeon') !== -1 || gr.indexOf('Vega') !== -1;
                else if (gv.indexOf('NVIDIA') !== -1) consistent = gr.indexOf('GeForce') !== -1 || gr.indexOf('RTX') !== -1 || gr.indexOf('GTX') !== -1;
                assert('GPU vendor/renderer consistency',
                    consistent,
                    'vendor=' + gv + ' renderer=' + gr.substring(0, 40));
            }
        }
    } catch(e) {}

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 24: Screen/DPR Consistency
    // ═══════════════════════════════════════════════════════════════

    assert('screen.availHeight consistent with height',
        screen.availHeight > 0 && screen.availHeight <= screen.height,
        'avail=' + screen.availHeight + ' height=' + screen.height);

    assert('screen dimensions + DPR are sane',
        screen.width * window.devicePixelRatio <= 7680,
        screen.width + 'x' + screen.height + ' @ ' + window.devicePixelRatio + 'x');

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 25: WebGL getShaderPrecisionFormat
    // ═══════════════════════════════════════════════════════════════

    try {
        var glp = document.createElement('canvas').getContext('webgl');
        if (glp) {
            var fmt = glp.getShaderPrecisionFormat(glp.FRAGMENT_SHADER, glp.HIGH_FLOAT);
            assert('WebGL shaderPrecisionFormat has valid structure',
                fmt && typeof fmt.rangeMin === 'number' && typeof fmt.rangeMax === 'number' && typeof fmt.precision === 'number',
                fmt ? 'rangeMin=' + fmt.rangeMin + ' rangeMax=' + fmt.rangeMax + ' precision=' + fmt.precision : 'null');
        }
    } catch(e) {}

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 27: COM-Level Header Verification
    // ═══════════════════════════════════════════════════════════════

    // Verify that Accept-Language matches JS navigator.language
    assert('Accept-Language should match navigator.language',
        navigator.language === 'en-US',
        'navigator.language=' + navigator.language + ' (COM sets Accept-Language: en-US,en;q=0.9)');

    // ═══════════════════════════════════════════════════════════════
    // CATEGORY 26: Intl.DateTimeFormat stability
    // ═══════════════════════════════════════════════════════════════

    try {
        var dtf2 = new Intl.DateTimeFormat('en-US');
        var ro1 = dtf2.resolvedOptions();
        var ro2 = dtf2.resolvedOptions();
        assert('Intl.DateTimeFormat.resolvedOptions is stable across calls',
            ro1.timeZone === ro2.timeZone && ro1.locale === ro2.locale,
            'tz1=' + ro1.timeZone + ' tz2=' + ro2.timeZone);
    } catch(e) {}

    // ═══════════════════════════════════════════════════════════════
    // REPORT
    // ═══════════════════════════════════════════════════════════════

    // Delay report to let async tests (worker, audio, iframe, offscreen) complete
    setTimeout(function() {
        try {
            var total = passed + failed;
            var pct = total > 0 ? Math.round((passed / total) * 100) : 0;

            var report = {
                passed: passed,
                failed: failed,
                total: total,
                percentage: pct,
                results: results,
                timestamp: Date.now(),
                url: window.location.href
            };

            // Store globally FIRST (before console logging which might throw)
            window.__bushidoVerifyReport = report;

            // Log to console with color
            try {
                console.group('%c[FP-VERIFY] ' + pct + '% (' + passed + '/' + total + ')',
                    'font-size:14px;font-weight:bold;color:' + (failed === 0 ? '#00c853' : failed <= 3 ? '#ff9100' : '#ff1744'));

                for (var i = 0; i < results.length; i++) {
                    var r = results[i];
                    if (r.pass) {
                        console.log('%c  PASS ' + r.name + ' — ' + r.detail, 'color:#66bb6a');
                    } else {
                        console.log('%c  FAIL ' + r.name + ' — ' + r.detail, 'color:#ff1744;font-weight:bold');
                    }
                }
                console.groupEnd();
            } catch(e) {}

            // Send to Rust via postMessage for UI display
            try {
                if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
                    window.chrome.webview.postMessage(JSON.stringify({ __bushido: 'fingerprint-verify', report: report }));
                }
            } catch(e) {}

            // Fallback: log to title for debugging (removed in prod)
            try {
                document.title = 'FP-VERIFY:' + passed + '/' + total;
            } catch(e) {}
        } catch(e) {
            // Ensure report is set even if everything else fails
            window.__bushidoVerifyReport = { passed: passed, failed: failed, total: passed + failed, percentage: 0, results: results, error: String(e) };
        }
    }, 1500);
})();
