(function() {
    'use strict';
    if (window.__bushidoCosmeticObs) return;
    Object.defineProperty(window, '__bushidoCosmeticObs', { value: true, writable: false, configurable: false });

    var sentClasses = new Set();
    var sentIds = new Set();
    var pendingClasses = [];
    var pendingIds = [];
    var styleEl = null;
    var appliedSelectors = new Set();
    var flushTimer = null;

    function collectFromElement(el) {
        if (!el || el.nodeType !== 1) return;
        if (el.classList) {
            for (var i = 0; i < el.classList.length; i++) {
                var c = el.classList[i];
                if (c && !sentClasses.has(c)) {
                    sentClasses.add(c);
                    pendingClasses.push(c);
                }
            }
        }
        if (el.id && !sentIds.has(el.id)) {
            sentIds.add(el.id);
            pendingIds.push(el.id);
        }
    }

    function collectAll(root) {
        try {
            var all = root.querySelectorAll('[class],[id]');
            for (var i = 0; i < all.length; i++) {
                collectFromElement(all[i]);
            }
        } catch(e) {}
    }

    function flush() {
        if (pendingClasses.length === 0 && pendingIds.length === 0) return;
        var msg = {
            __bushido: 'cosmetic-probe',
            classes: pendingClasses.splice(0),
            ids: pendingIds.splice(0)
        };
        try {
            window.chrome.webview.postMessage(JSON.stringify(msg));
        } catch(e) {}
    }

    function scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(function() {
            flushTimer = null;
            flush();
        }, 500);
    }

    // Called by Rust via wv.eval() / ExecuteScript when selectors arrive
    window.__bushidoApplyCosmetic = function(selectors) {
        if (!selectors || selectors.length === 0) return;
        var newSels = [];
        for (var i = 0; i < selectors.length; i++) {
            if (!appliedSelectors.has(selectors[i])) {
                appliedSelectors.add(selectors[i]);
                newSels.push(selectors[i]);
            }
        }
        if (newSels.length === 0) return;
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'bushido-generic-cosmetic';
            (document.head || document.documentElement).appendChild(styleEl);
        }
        styleEl.textContent += newSels.join(',') + '{display:none!important}\n';
    };

    // Initial collection from existing DOM
    if (document.documentElement) {
        collectAll(document.documentElement);
        scheduleFlush();
    }

    // Observe mutations for new elements
    var observer = new MutationObserver(function(mutations) {
        var dirty = false;
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            for (var j = 0; j < m.addedNodes.length; j++) {
                var node = m.addedNodes[j];
                if (node.nodeType === 1) {
                    collectFromElement(node);
                    if (node.querySelectorAll) {
                        collectAll(node);
                    }
                    dirty = true;
                }
            }
            if (m.type === 'attributes' && m.target && m.target.nodeType === 1) {
                collectFromElement(m.target);
                dirty = true;
            }
        }
        if (dirty && (pendingClasses.length > 0 || pendingIds.length > 0)) {
            scheduleFlush();
        }
    });

    observer.observe(document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'id']
    });
})();
