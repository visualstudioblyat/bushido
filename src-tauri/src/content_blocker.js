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
})();
