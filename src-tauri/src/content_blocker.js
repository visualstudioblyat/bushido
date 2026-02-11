(function() {
    'use strict';
    if (window.__bushidoPrivacy) return;
    Object.defineProperty(window, '__bushidoPrivacy', { value: true, writable: false, configurable: false });

    // 1. css cosmetic hiding (easylist + fanboy + site-specific rules)
    try {
        var style = document.createElement('style');
        var hide = '{display:none!important;height:0!important;min-height:0!important;overflow:hidden!important;pointer-events:none!important;position:absolute!important;left:-9999px!important;}';
        style.textContent = [
            // google ads
            '[id*="google_ads"],[id*="GoogleAds"]',
            '[class*="adsbygoogle"],ins.adsbygoogle',
            '[data-ad],[data-ad-slot],[data-ad-client],[data-ad-format]',
            '[data-google-query-id]',
            'iframe[src*="doubleclick"],iframe[src*="googlesyndication"]',
            'iframe[src*="googleads"],iframe[id*="google_ads"]',
            '#google_ads_frame1,#google_ads_frame2,#google_ads_frame3',

            // generic ad containers
            '[class*="ad-container"],[class*="ad-wrapper"],[class*="ad-slot"]',
            '[class*="ad-placeholder"],[class*="ad-block"],[class*="ad-box"]',
            '[class*="ad-zone"],[class*="ad-space"],[class*="ad-panel"]',
            '[class*="ad-section"],[class*="ad-row"],[class*="ad-col"]',
            '[class*="ad-unit"],[class*="ad-holder"],[class*="ad-frame"]',
            '.ad-banner,.ad-leaderboard,.ad-sidebar,.ad-footer,.ad-header',
            '.ad-top,.ad-bottom,.ad-left,.ad-right,.ad-middle,.ad-inline',
            '#ad-wrapper,#ad-container,#ad-banner,#ad-footer,#ad-header',
            '#ad-top,#ad-bottom,#ad-sidebar,#ad-leaderboard',
            'div[id^="ad-"],div[id^="ad_"],div[class^="ad-"],div[class^="ad_"]',
            'div[id^="ads-"],div[id^="ads_"],div[class^="ads-"],div[class^="ads_"]',
            '[aria-label="advertisement"],[aria-label="Ads"],[aria-label="ad"]',
            '[role="complementary"][class*="ad"]',

            // taboola/outbrain/mgid
            '[id*="taboola-"],[class*="taboola"],.trc_rbox,.trc_related_container',
            '[id*="outbrain"],[class*="outbrain"],.ob-widget,.ob-smartfeed',
            '[class*="mgid"],[id*="mgid"],.mgbox',
            '.OUTBRAIN,.ob-dynamic-rec-container',

            // amazon ads
            'iframe[src*="amazon-adsystem"]',
            '[class*="amzn-native-ad"],.a-ad,.amsm,.ams-ad',

            // sponsored/promoted content
            '.sponsored-content,.promoted-content,.paid-content',
            '.native-ad,.sponsored-post,.promoted-post',
            '[class*="sponsored"],[data-sponsored]',
            '[class*="advertorial"],.advertorial',
            '.partner-content,.branded-content,.commercial-content',

            // youtube
            '.ytd-ad-slot-renderer,.video-ads,.ytp-ad-module',
            '#player-ads,.ytd-promoted-sparkles-web-renderer',
            '.ytd-display-ad-renderer,.ytd-statement-banner-renderer',
            '.ytd-in-feed-ad-layout-renderer,.ytd-banner-promo-renderer',
            '.ytp-ad-overlay-container,#masthead-ad',
            '.ytd-rich-item-renderer[is-ad]',
            '.ytd-promoted-video-renderer,.ytd-compact-promoted-video-renderer',
            '.ytp-ad-skip-button-container,.ytp-ad-text',
            '.ytd-action-companion-ad-renderer,.ytd-player-legacy-desktop-watch-ads-renderer',
            '#related ytd-promoted-sparkles-web-renderer',
            'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"]',

            // reddit
            '.promotedlink,.promoted,.ad-container',
            'div[data-testid="ad-slot"]',
            '[class*="promoted-tag"],.listing-ad',
            'shreddit-ad-post,.promotedLink',

            // twitter/x
            '[data-testid="promotedIndicator"]',
            'article:has([data-testid="promotedIndicator"])',
            '[class*="promote"]',

            // facebook/instagram
            'div[data-pagelet*="FeedUnit"]:has(a[href*="/ads/"])',
            'span:has(> a[href="/ads/about/"])',

            // news sites common patterns
            '.dfp-ad,.dfp-tag-wrapper,.ad-dfp',
            '.ad-recirc,.ad-mod,.ad-article,.ad-interstitial',
            '[class*="stickyAd"],[class*="sticky-ad"],[class*="sticky_ad"]',
            '.below-article-ad,.in-article-ad,.mid-article-ad',
            '.interstitial-ad,.pre-roll-ad,.post-roll-ad',
            '.billboard-ad,.halfpage-ad,.skyscraper-ad,.rectangle-ad',

            // popup/overlay ads
            '.popunder,[class*="popunder"],[class*="pop-under"]',
            '[class*="interstitial"],[id*="interstitial"]',
            '[class*="overlay-ad"],[id*="overlay-ad"]',
            '.lightbox-ad,[class*="lightbox-ad"]',

            // adult site specific
            '[class*="TrafficStars"],[id*="trafficStars"]',
            '[class*="exo-"],[id*="exoclick"]',
            'div[id^="pb_ads"]',
            'a[href*="trafficjunky.net"],a[href*="trafficstars.com"]',
            '.abm-ad-container,.abm-container',
            'div[class*="ad-manager"]',
            'a[href*="juicyads.com"],a[href*="exoclick.com"]',

            // newsletter/signup popups
            '[class*="newsletter-popup"],[class*="newsletter-modal"]',
            '[class*="subscribe-popup"],[class*="subscribe-modal"]',
            '[class*="email-popup"],[class*="email-modal"]',
            '[class*="signup-popup"],[class*="signup-modal"]',

            // notification prompts
            '[class*="push-notification"],[class*="notification-prompt"]',
            '[class*="browser-notification"],[class*="notify-box"]',

            // social widgets (tracking heavy)
            '.fb-like,.fb-comments,.fb-page,.fb-share-button',
            '[class*="social-share-bar"],[class*="share-buttons"]',
            '.twitter-tweet-rendered,.instagram-media-rendered',

            // mediavine/freestar/ezoic
            '[id*="ezoic"],[class*="ezoic"],.ezoic-ad',
            '[data-freestar-ad],[id*="freestar"]',
            '.mv-ad-box,[class*="mediavine"]',

            // misc ad networks
            '[class*="adthrive"],[data-adthrive]',
            '[class*="carbonads"],[id*="carbonads"],.carbonad',
            '[class*="buysellads"],.bsa-cpc',
            '[class*="infolinks"],.infolinks_main',
            '#adhesion,.adhesion-unit',
            '.nativendo,[class*="nativendo"]',
            '[class*="rev-content"],[id*="rev-content"]',
        ].join(',') + hide;
        (document.head || document.documentElement).appendChild(style);
    } catch(e) {}

    // 2. webrtc leak prevention
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

    // 3. privacy headers via meta tags
    try {
        var meta = document.createElement('meta');
        meta.setAttribute('name', 'referrer');
        meta.setAttribute('content', 'origin');
        (document.head || document.documentElement).appendChild(meta);
    } catch(e) {}

    // 4. navigator privacy properties
    try {
        Object.defineProperty(navigator, 'doNotTrack', { get: function() { return '1'; }, configurable: true });
    } catch(e) {}
    try {
        Object.defineProperty(navigator, 'globalPrivacyControl', { get: function() { return true; }, configurable: true });
    } catch(e) {}

    // 5. block navigator.plugins enumeration (fingerprinting)
    try {
        Object.defineProperty(navigator, 'plugins', { get: function() { return []; }, configurable: true });
        Object.defineProperty(navigator, 'mimeTypes', { get: function() { return []; }, configurable: true });
    } catch(e) {}

    // 6. block battery api (fingerprinting)
    try {
        if (navigator.getBattery) {
            navigator.getBattery = undefined;
        }
    } catch(e) {}

    // 7. normalize hardware concurrency
    try {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: function() { return 4; }, configurable: false });
    } catch(e) {}

    // 8. normalize language
    try {
        Object.defineProperty(navigator, 'language', { get: function() { return 'en-US'; }, configurable: false });
        Object.defineProperty(navigator, 'languages', { get: function() { return ['en-US','en']; }, configurable: false });
    } catch(e) {}

    // 9. normalize platform
    try {
        Object.defineProperty(navigator, 'platform', { get: function() { return 'Win32'; }, configurable: false });
    } catch(e) {}

    // 10. normalize screen fingerprint
    try {
        var sw = window.screen.width, sh = window.screen.height;
        Object.defineProperty(screen, 'availWidth', { get: function() { return sw; }, configurable: false });
        Object.defineProperty(screen, 'availHeight', { get: function() { return sh; }, configurable: false });
        Object.defineProperty(screen, 'availLeft', { get: function() { return 0; }, configurable: false });
        Object.defineProperty(screen, 'availTop', { get: function() { return 0; }, configurable: false });
        Object.defineProperty(screen, 'colorDepth', { get: function() { return 24; }, configurable: false });
        Object.defineProperty(screen, 'pixelDepth', { get: function() { return 24; }, configurable: false });
    } catch(e) {}

    // 11. canvas fingerprint noise
    try {
        var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        var origToBlob = HTMLCanvasElement.prototype.toBlob;
        var origGetCtx = HTMLCanvasElement.prototype.getContext;
        var addNoise = function(canvas) {
            try {
                var ctx = origGetCtx.call(canvas, '2d');
                if (!ctx) return;
                var w = canvas.width, h = canvas.height;
                if (w === 0 || h === 0) return;
                var img = ctx.getImageData(0, 0, w, h);
                var d = img.data;
                for (var i = 0; i < d.length; i += 4) { d[i] = d[i] ^ 1; }
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
    } catch(e) {}

    // 12. webgl vendor/renderer spoofing
    try {
        var spoofedVendor = 'Google Inc. (Intel)';
        var spoofedRenderer = 'ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)';
        var origGetParam = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(p) {
            if (p === 37445) return spoofedVendor;
            if (p === 37446) return spoofedRenderer;
            return origGetParam.call(this, p);
        };
        if (typeof WebGL2RenderingContext !== 'undefined') {
            var origGetParam2 = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(p) {
                if (p === 37445) return spoofedVendor;
                if (p === 37446) return spoofedRenderer;
                return origGetParam2.call(this, p);
            };
        }
    } catch(e) {}

    // 13. audioctx fingerprint noise
    try {
        var origGetFloat = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = function(arr) {
            origGetFloat.call(this, arr);
            for (var i = 0; i < arr.length; i++) { arr[i] += (Math.random() - 0.5) * 0.01; }
        };
    } catch(e) {}

    // 14. block network information api
    try {
        Object.defineProperty(navigator, 'connection', { get: function() { return undefined; }, configurable: false });
        Object.defineProperty(navigator, 'mozConnection', { get: function() { return undefined; }, configurable: false });
        Object.defineProperty(navigator, 'webkitConnection', { get: function() { return undefined; }, configurable: false });
    } catch(e) {}

    // 15. block font enumeration
    try {
        if (document.fonts) {
            Object.defineProperty(document, 'fonts', {
                get: function() {
                    return { forEach: function(){}, size: 0, ready: Promise.resolve(),
                             check: function(){ return false; }, has: function(){ return false; } };
                }, configurable: false
            });
        }
    } catch(e) {}

    // 16. block service worker registration (prevents sw-based tracker bypass)
    try {
        if (navigator.serviceWorker) {
            Object.defineProperty(navigator, 'serviceWorker', {
                get: function() {
                    return {
                        register: function() { return Promise.reject(new DOMException('blocked','SecurityError')); },
                        getRegistration: function() { return Promise.resolve(undefined); },
                        getRegistrations: function() { return Promise.resolve([]); },
                        ready: new Promise(function(){})
                    };
                }, configurable: false
            });
        }
    } catch(e) {}
})();
