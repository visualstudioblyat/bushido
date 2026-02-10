(function() {
    'use strict';
    if (window.__bushidoCookieBlocker) return;
    Object.defineProperty(window, '__bushidoCookieBlocker', { value: true, writable: false, configurable: false });

    const REJECT_SELECTORS = [
        // specific frameworks
        '#CybotCookiebotDialogBodyButtonDecline',
        '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
        '#onetrust-reject-all-handler',
        '.ot-pc-refuse-all-handler',
        'button.sp_choice_type_REJECT_ALL',
        '#didomi-notice-disagree-button',
        '.klaro .cn-decline',
        '.osano-cm-denyAll',
        'button[data-cookiefirst-action="reject"]',
        'button[data-testid="uc-deny-all-button"]',
        '.qc-cmp2-summary-buttons button[mode="secondary"]',
        // generic reject/decline
        'button[id*="reject" i]', 'button[class*="reject" i]',
        'a[id*="reject" i]', 'a[class*="reject" i]',
        'button[id*="decline" i]', 'button[class*="decline" i]',
        'button[id*="deny" i]', 'button[class*="deny" i]',
        'button[id*="necessary" i]', 'button[class*="necessary" i]',
    ];

    const BANNER_SELECTORS = [
        '#CybotCookiebotDialog',
        '#onetrust-banner-sdk', '#onetrust-consent-sdk',
        '.qc-cmp2-container',
        '#didomi-host',
        '.klaro',
        '.osano-cm-window',
        '#cookie-notice', '#cookie-law-info-bar',
        '#gdpr-cookie-notice',
        '[class*="cookie-banner" i]', '[class*="cookie-consent" i]',
        '[class*="cookieBanner" i]',
        '[id*="cookie-banner" i]', '[id*="cookie-consent" i]',
        '[role="dialog"][class*="consent" i]',
    ];

    const REJECT_TEXT = [
        /^reject\s*(all)?$/i,
        /^decline\s*(all)?$/i,
        /^deny\s*(all)?$/i,
        /^refuse\s*(all)?$/i,
        /^(only\s*)?necessary$/i,
        /^(only\s*)?essential$/i,
        /^no\s*thanks$/i,
    ];

    function tryReject() {
        for (const sel of REJECT_SELECTORS) {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
                btn.click();
                return true;
            }
        }
        // text-based fallback inside known banners
        for (const sel of BANNER_SELECTORS) {
            const banner = document.querySelector(sel);
            if (!banner) continue;
            const buttons = banner.querySelectorAll('button, a[role="button"], a[class*="btn"]');
            for (const btn of buttons) {
                const text = btn.textContent.trim();
                for (const pattern of REJECT_TEXT) {
                    if (pattern.test(text)) {
                        btn.click();
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function cleanUp() {
        for (const sel of BANNER_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) el.remove();
        }
        document.querySelectorAll(
            '.onetrust-overlay, #CybotCookiebotDialogBodyUnderlay, ' +
            '.didomi-popup-backdrop, .qc-cmp2-backdrop, ' +
            '[class*="cookie-overlay" i], [class*="consent-overlay" i]'
        ).forEach(el => el.remove());
        document.body.style.overflow = '';
        document.documentElement.style.overflow = '';
    }

    let attempts = 0;
    function attempt() {
        if (tryReject()) {
            setTimeout(cleanUp, 500);
            return;
        }
        if (++attempts < 5) setTimeout(attempt, 1000);
    }

    const observer = new MutationObserver(() => {
        if (tryReject()) {
            setTimeout(cleanUp, 500);
            observer.disconnect();
        }
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    document.addEventListener('DOMContentLoaded', attempt);
    window.addEventListener('load', () => setTimeout(attempt, 500));
    setTimeout(() => observer.disconnect(), 10000);
})();
