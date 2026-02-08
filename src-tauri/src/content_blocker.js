(function() {
    'use strict';
    if (window.__bushidoBlocker) return;
    window.__bushidoBlocker = true;

    const BLOCKED = {{BLOCKED_DOMAINS_SET}};
    let blockedCount = 0;
    let reportTimer = null;

    function extractDomain(url) {
        try { return new URL(url, location.href).hostname.toLowerCase(); }
        catch { return ''; }
    }

    function isBlocked(hostname) {
        if (!hostname) return false;
        let d = hostname;
        while (d) {
            if (BLOCKED.has(d)) return true;
            const i = d.indexOf('.');
            if (i === -1) break;
            d = d.substring(i + 1);
        }
        return false;
    }

    function isUrlBlocked(url) {
        if (!url || typeof url !== 'string') return false;
        if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) return false;
        return isBlocked(extractDomain(url));
    }

    function onBlocked() {
        blockedCount++;
        if (reportTimer) clearTimeout(reportTimer);
        reportTimer = setTimeout(function() {
            reportTimer = null;
            try {
                var real = document.title || '';
                document.title = '__BUSHIDO_BLOCKED__:' + blockedCount;
                // give rust enough time to catch the title change
                setTimeout(function() { document.title = real; }, 150);
            } catch(e) {}
        }, 300);
    }

    // 1. override fetch
    try {
        var origFetch = window.fetch;
        window.fetch = function(input, init) {
            try {
                var url = (typeof input === 'string') ? input :
                          (input && input.url) ? input.url : String(input);
                if (isUrlBlocked(url)) { onBlocked(); return Promise.reject(new TypeError('blocked')); }
            } catch(e) {}
            return origFetch.call(this, input, init);
        };
    } catch(e) {}

    // 2. override xhr
    try {
        var origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            try {
                if (isUrlBlocked(String(url))) { onBlocked(); this.__b = true; return; }
            } catch(e) {}
            return origOpen.apply(this, arguments);
        };
        var origSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.send = function() {
            if (this.__b) { try { this.dispatchEvent(new Event('error')); } catch(e) {} return; }
            return origSend.apply(this, arguments);
        };
    } catch(e) {}

    // 3. override setAttribute to catch src/href assignments
    try {
        var origSetAttr = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
            try {
                if ((name === 'src' || name === 'href') && isUrlBlocked(String(value))) {
                    onBlocked();
                    return;
                }
            } catch(e) {}
            return origSetAttr.call(this, name, value);
        };
    } catch(e) {}

    // 4. intercept sendBeacon
    try {
        if (navigator.sendBeacon) {
            var origBeacon = navigator.sendBeacon.bind(navigator);
            navigator.sendBeacon = function(url, data) {
                if (isUrlBlocked(String(url))) { onBlocked(); return false; }
                return origBeacon(url, data);
            };
        }
    } catch(e) {}

    // 5. intercept new Image() src sets
    try {
        var imgSrcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
        if (imgSrcDesc && imgSrcDesc.set) {
            var origImgSet = imgSrcDesc.set;
            Object.defineProperty(HTMLImageElement.prototype, 'src', {
                get: imgSrcDesc.get,
                set: function(val) {
                    if (isUrlBlocked(String(val))) { onBlocked(); return; }
                    return origImgSet.call(this, val);
                },
                configurable: true, enumerable: true
            });
        }
    } catch(e) {}

    // 6. intercept script src sets
    try {
        var scriptSrcDesc = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
        if (scriptSrcDesc && scriptSrcDesc.set) {
            var origScriptSet = scriptSrcDesc.set;
            Object.defineProperty(HTMLScriptElement.prototype, 'src', {
                get: scriptSrcDesc.get,
                set: function(val) {
                    if (isUrlBlocked(String(val))) { onBlocked(); return; }
                    return origScriptSet.call(this, val);
                },
                configurable: true, enumerable: true
            });
        }
    } catch(e) {}

    // 7. intercept iframe src sets
    try {
        var iframeSrcDesc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
        if (iframeSrcDesc && iframeSrcDesc.set) {
            var origIframeSet = iframeSrcDesc.set;
            Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
                get: iframeSrcDesc.get,
                set: function(val) {
                    if (isUrlBlocked(String(val))) { onBlocked(); return; }
                    return origIframeSet.call(this, val);
                },
                configurable: true, enumerable: true
            });
        }
    } catch(e) {}

    // 8. css hiding (easylist + fanboy + site-specific cosmetic rules)
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

    // 9. MutationObserver
    function checkEl(el) {
        if (!el || el.nodeType !== 1) return;
        try {
            var tag = el.tagName;
            if (tag === 'SCRIPT' || tag === 'IFRAME' || tag === 'IMG' || tag === 'LINK') {
                var src = el.getAttribute('src') || el.getAttribute('href') || '';
                if (src && isUrlBlocked(src)) {
                    el.remove();
                    onBlocked();
                    return;
                }
            }
            var kids = el.children;
            if (kids) for (var i = 0; i < kids.length; i++) checkEl(kids[i]);
        } catch(e) {}
    }

    try {
        var obs = new MutationObserver(function(mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];
                if (m.addedNodes) {
                    for (var j = 0; j < m.addedNodes.length; j++) checkEl(m.addedNodes[j]);
                }
                if (m.type === 'attributes' && m.attributeName === 'src') {
                    try {
                        var src = m.target.getAttribute('src') || '';
                        if (src && isUrlBlocked(src)) { m.target.remove(); onBlocked(); }
                    } catch(e) {}
                }
            }
        });

        function startObserver() {
            if (document.documentElement) {
                obs.observe(document.documentElement, {
                    childList: true, subtree: true,
                    attributes: true, attributeFilter: ['src']
                });
            }
        }

        if (document.documentElement) startObserver();
        else document.addEventListener('DOMContentLoaded', startObserver);
    } catch(e) {}

    // 10. scan existing DOM
    function scanDOM() {
        try {
            var els = document.querySelectorAll('script[src],iframe[src],img[src],link[href]');
            for (var i = 0; i < els.length; i++) {
                var url = els[i].getAttribute('src') || els[i].getAttribute('href') || '';
                if (url && isUrlBlocked(url)) {
                    els[i].remove();
                    onBlocked();
                }
            }
        } catch(e) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', scanDOM);
    } else {
        scanDOM();
    }
    window.addEventListener('load', scanDOM);
})();
