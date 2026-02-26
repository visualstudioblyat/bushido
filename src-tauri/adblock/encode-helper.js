const resources = {};

resources['set-constant'] = `(function() {
  var chain = '{{1}}';
  var cValue = '{{2}}';
  var trueValue;
  if ( cValue === 'true' ) trueValue = true;
  else if ( cValue === 'false' ) trueValue = false;
  else if ( cValue === 'null' ) trueValue = null;
  else if ( cValue === 'undefined' ) trueValue = undefined;
  else if ( cValue === 'noopFunc' ) trueValue = function(){};
  else if ( cValue === 'trueFunc' ) trueValue = function(){ return true; };
  else if ( cValue === 'falseFunc' ) trueValue = function(){ return false; };
  else if ( cValue === '' ) trueValue = '';
  else if ( cValue === '0' ) trueValue = 0;
  else if ( cValue === '1' ) trueValue = 1;
  else if ( cValue === '-1' ) trueValue = -1;
  else if ( cValue === 'yes' ) trueValue = 'yes';
  else if ( cValue === 'no' ) trueValue = 'no';
  else return;
  var props = chain.split('.');
  var owner = window;
  for ( var i = 0; i < props.length - 1; i++ ) {
    var p = props[i];
    if ( typeof owner[p] !== 'object' && typeof owner[p] !== 'function' ) {
      owner[p] = {};
    }
    owner = owner[p];
  }
  var prop = props[props.length - 1];
  try {
    Object.defineProperty(owner, prop, {
      configurable: true,
      get: function() { return trueValue; },
      set: function() {}
    });
  } catch(e) {}
})();`;

resources['no-setTimeout-if'] = `(function() {
  var needle = '{{1}}';
  var delay = parseInt('{{2}}', 10);
  var reNeedle = needle !== '' && needle !== '{{1}}' ? new RegExp(needle) : null;
  var origSetTimeout = window.setTimeout;
  window.setTimeout = new Proxy(origSetTimeout, {
    apply: function(target, thisArg, args) {
      var a = args[0];
      var d = args[1];
      if ( reNeedle !== null ) {
        var src = typeof a === 'function' ? a.toString() : String(a);
        if ( reNeedle.test(src) ) {
          if ( isNaN(delay) || d === delay ) return;
        }
      }
      return target.apply(thisArg, args);
    }
  });
})();`;

resources['no-setInterval-if'] = `(function() {
  var needle = '{{1}}';
  var delay = parseInt('{{2}}', 10);
  var reNeedle = needle !== '' && needle !== '{{1}}' ? new RegExp(needle) : null;
  var origSetInterval = window.setInterval;
  window.setInterval = new Proxy(origSetInterval, {
    apply: function(target, thisArg, args) {
      var a = args[0];
      var d = args[1];
      if ( reNeedle !== null ) {
        var src = typeof a === 'function' ? a.toString() : String(a);
        if ( reNeedle.test(src) ) {
          if ( isNaN(delay) || d === delay ) return;
        }
      }
      return target.apply(thisArg, args);
    }
  });
})();`;

resources['prevent-addEventListener'] = `(function() {
  var type = '{{1}}';
  var needle = '{{2}}';
  var reType = type !== '' && type !== '{{1}}' ? new RegExp(type) : null;
  var reNeedle = needle !== '' && needle !== '{{2}}' ? new RegExp(needle) : null;
  var origAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = new Proxy(origAdd, {
    apply: function(target, thisArg, args) {
      var t = args[0];
      var fn = args[1];
      if ( reType !== null && reType.test(t) ) {
        if ( reNeedle === null ) return;
        var src = typeof fn === 'function' ? fn.toString() : String(fn);
        if ( reNeedle.test(src) ) return;
      }
      return target.apply(thisArg, args);
    }
  });
})();`;

resources['prevent-fetch'] = `(function() {
  var needle = '{{1}}';
  var reNeedle = needle !== '' && needle !== '{{1}}' ? new RegExp(needle) : null;
  var origFetch = window.fetch;
  window.fetch = new Proxy(origFetch, {
    apply: function(target, thisArg, args) {
      var input = args[0];
      var url = typeof input === 'string' ? input : input instanceof Request ? input.url : '';
      if ( reNeedle !== null && reNeedle.test(url) ) {
        return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
      }
      return target.apply(thisArg, args);
    }
  });
})();`;

resources['prevent-xhr'] = `(function() {
  var needle = '{{1}}';
  var reNeedle = needle !== '' && needle !== '{{1}}' ? new RegExp(needle) : null;
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = new Proxy(origOpen, {
    apply: function(target, thisArg, args) {
      var url = args[1];
      if ( reNeedle !== null && reNeedle.test(url) ) {
        thisArg.abort = function() {};
        thisArg.send = function() {
          Object.defineProperty(thisArg, 'readyState', { value: 4, writable: false });
          Object.defineProperty(thisArg, 'status', { value: 200, writable: false });
          Object.defineProperty(thisArg, 'statusText', { value: 'OK', writable: false });
          Object.defineProperty(thisArg, 'responseText', { value: '', writable: false });
          Object.defineProperty(thisArg, 'response', { value: '', writable: false });
          thisArg.dispatchEvent(new Event('load'));
          thisArg.dispatchEvent(new Event('loadend'));
        };
        return;
      }
      return target.apply(thisArg, args);
    }
  });
})();`;

resources['json-prune'] = `(function() {
  var rawPrunePaths = '{{1}}';
  var rawNeedlePaths = '{{2}}';
  if ( rawPrunePaths === '' || rawPrunePaths === '{{1}}' ) return;
  var prunePaths = rawPrunePaths.split(/ +/);
  var needlePaths = rawNeedlePaths !== '' && rawNeedlePaths !== '{{2}}' ? rawNeedlePaths.split(/ +/) : [];
  var origParse = JSON.parse;
  JSON.parse = new Proxy(origParse, {
    apply: function(target, thisArg, args) {
      var r = target.apply(thisArg, args);
      if ( r instanceof Object ) {
        var dominated = needlePaths.length === 0;
        if ( !dominated ) {
          for ( var i = 0; i < needlePaths.length; i++ ) {
            var val = r;
            var parts = needlePaths[i].split('.');
            for ( var j = 0; j < parts.length; j++ ) {
              val = val[parts[j]];
              if ( val === undefined ) break;
            }
            if ( val !== undefined ) { dominated = true; break; }
          }
        }
        if ( dominated ) {
          for ( var i = 0; i < prunePaths.length; i++ ) {
            var obj = r;
            var parts = prunePaths[i].split('.');
            for ( var j = 0; j < parts.length - 1; j++ ) {
              obj = obj[parts[j]];
              if ( obj === undefined ) break;
            }
            if ( obj !== undefined ) {
              delete obj[parts[parts.length - 1]];
            }
          }
        }
      }
      return r;
    }
  });
})();`;

resources['noeval'] = `(function() {
  window.eval = new Proxy(window.eval, {
    apply: function(target, thisArg, args) {
      return;
    }
  });
})();`;

resources['remove-attr'] = `(function() {
  var attr = '{{1}}';
  var selector = '{{2}}';
  if ( attr === '' || attr === '{{1}}' ) return;
  var sel = selector !== '' && selector !== '{{2}}' ? selector : '[' + attr + ']';
  var observer = new MutationObserver(function() {
    var nodes = document.querySelectorAll(sel);
    for ( var i = 0; i < nodes.length; i++ ) {
      nodes[i].removeAttribute(attr);
    }
  });
  observer.observe(document, { attributes: true, childList: true, subtree: true });
  var nodes = document.querySelectorAll(sel);
  for ( var i = 0; i < nodes.length; i++ ) {
    nodes[i].removeAttribute(attr);
  }
})();`;

resources['remove-class'] = `(function() {
  var className = '{{1}}';
  var selector = '{{2}}';
  if ( className === '' || className === '{{1}}' ) return;
  var sel = selector !== '' && selector !== '{{2}}' ? selector : '.' + className;
  var observer = new MutationObserver(function() {
    var nodes = document.querySelectorAll(sel);
    for ( var i = 0; i < nodes.length; i++ ) {
      nodes[i].classList.remove(className);
    }
  });
  observer.observe(document, { attributes: true, childList: true, subtree: true });
  var nodes = document.querySelectorAll(sel);
  for ( var i = 0; i < nodes.length; i++ ) {
    nodes[i].classList.remove(className);
  }
})();`;

resources['disable-newtab-links'] = `(function() {
  document.addEventListener('click', function(e) {
    var el = e.target;
    while ( el && el.tagName !== 'A' ) el = el.parentElement;
    if ( el && el.hasAttribute('target') ) {
      var target = el.getAttribute('target');
      if ( target === '_blank' || target === '_new' ) {
        el.setAttribute('target', '_self');
      }
    }
  }, true);
})();`;

resources['window.name-defuser'] = `(function() {
  if ( window === window.top ) {
    window.name = '';
  }
})();`;

resources['nowebrtc'] = `(function() {
  var rtc = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if ( !rtc ) return;
  window.RTCPeerConnection = function() { throw new Error('WebRTC blocked'); };
  if ( window.webkitRTCPeerConnection ) {
    window.webkitRTCPeerConnection = window.RTCPeerConnection;
  }
})();`;

resources['set-cookie'] = `(function() {
  var name = '{{1}}';
  var value = '{{2}}';
  if ( name === '' || name === '{{1}}' ) return;
  if ( value === '{{2}}' ) value = '';
  var cookieVal = name + '=' + value + '; path=/; max-age=86400; SameSite=Lax';
  try { document.cookie = cookieVal; } catch(e) {}
})();`;

resources['googlesyndication_adsbygoogle'] = `(function() {
  var p = { push: function() {} };
  window.adsbygoogle = window.adsbygoogle || p;
  if ( typeof window.adsbygoogle.loaded === 'undefined' ) {
    window.adsbygoogle.loaded = true;
  }
  if ( typeof window.adsbygoogle.push !== 'function' ) {
    window.adsbygoogle.push = function() {};
  }
})();`;

resources['googletagservices_gpt'] = `(function() {
  var noopfn = function() {};
  var noopthisfn = function() { return this; };
  var noopnullfn = function() { return null; };
  var nooparrayfn = function() { return []; };
  var noopstrfn = function() { return ''; };
  var slot = {
    addService: noopthisfn,
    clearCategoryExclusions: noopthisfn,
    clearTargeting: noopthisfn,
    defineSizeMapping: noopthisfn,
    get: noopnullfn,
    getAdUnitPath: noopstrfn,
    getAttributeKeys: nooparrayfn,
    getCategoryExclusions: nooparrayfn,
    getDomId: noopstrfn,
    getResponseInformation: noopnullfn,
    getSlotElementId: noopstrfn,
    getSlotId: noopthisfn,
    getTargeting: nooparrayfn,
    getTargetingKeys: nooparrayfn,
    set: noopthisfn,
    setCategoryExclusion: noopthisfn,
    setClickUrl: noopthisfn,
    setCollapseEmptyDiv: noopthisfn,
    setSafeFrameConfig: noopthisfn,
    setTargeting: noopthisfn,
    updateTargetingFromMap: noopthisfn
  };
  var pubads = {
    addEventListener: noopthisfn, clear: noopfn, clearCategoryExclusions: noopthisfn,
    clearTagForChildDirectedTreatment: noopthisfn, clearTargeting: noopthisfn,
    collapseEmptyDivs: noopfn, defineOutOfPagePassback: function() { return slot; },
    definePassback: function() { return slot; }, disableInitialLoad: noopfn,
    display: noopfn, enable: noopfn, enableAsyncRendering: noopfn,
    enableLazyLoad: noopfn, enableSingleRequest: noopfn, enableVideoAds: noopfn,
    get: noopnullfn, getAttributeKeys: nooparrayfn, getTargeting: nooparrayfn,
    getTargetingKeys: nooparrayfn, getSlots: nooparrayfn, isInitialLoadDisabled: noopfn,
    refresh: noopfn, set: noopthisfn, setCategoryExclusion: noopthisfn,
    setCentering: noopfn, setCookieOptions: noopthisfn, setForceSafeFrame: noopthisfn,
    setLocation: noopthisfn, setPrivacySettings: noopthisfn, setPublisherProvidedId: noopthisfn,
    setRequestNonPersonalizedAds: noopthisfn, setSafeFrameConfig: noopthisfn,
    setTagForChildDirectedTreatment: noopthisfn, setTargeting: noopthisfn,
    setVideoContent: noopthisfn, updateCorrelator: noopfn
  };
  var companionAds = { addEventListener: noopthisfn, enableSyncLoading: noopfn, setRefreshUnfilledSlots: noopfn };
  var content = { addEventListener: noopthisfn, setContent: noopfn };
  window.googletag = window.googletag || {};
  var gt = window.googletag;
  gt.apiReady = true;
  gt.cmd = gt.cmd || [];
  gt.cmd.push = function(fn) { try { fn(); } catch(e) {} return 1; };
  gt.companionAds = function() { return companionAds; };
  gt.content = function() { return content; };
  gt.defineSlot = function() { return slot; };
  gt.defineOutOfPageSlot = function() { return slot; };
  gt.destroySlots = noopfn;
  gt.disablePublisherConsole = noopfn;
  gt.display = noopfn;
  gt.enableServices = noopfn;
  gt.getVersion = noopstrfn;
  gt.pubads = function() { return pubads; };
  gt.pubadsReady = true;
  gt.setAdIframeTitle = noopfn;
  gt.sizeMapping = function() { return { addSize: noopthisfn, build: noopnullfn }; };
  for ( var i = 0; i < gt.cmd.length; i++ ) {
    try { gt.cmd[i](); } catch(e) {}
  }
})();`;

resources['google-analytics_analytics'] = `(function() {
  var noopfn = function() {};
  var noopnull = function() { return null; };
  var Tracker = function() {};
  var p = Tracker.prototype;
  p.get = noopfn; p.set = noopfn; p.send = noopfn;
  var w = window;
  var gaName = w.GoogleAnalyticsObject || 'ga';
  var ga = function() {
    var len = arguments.length;
    if ( len === 0 ) return;
    var f = arguments[len-1];
    if ( typeof f === 'object' && f.hitCallback ) { try { f.hitCallback(); } catch(e) {} return; }
    if ( typeof f !== 'function' ) return;
    try { f(new Tracker()); } catch(e) {}
  };
  ga.create = function() { return new Tracker(); };
  ga.getByName = function() { return new Tracker(); };
  ga.getAll = function() { return [new Tracker()]; };
  ga.loaded = true;
  w[gaName] = ga;
  var dl = w.dataLayer;
  if ( dl instanceof Object && dl.hide instanceof Object && typeof dl.hide.end === 'function' ) {
    dl.hide.end();
  }
  if ( typeof w.gtag === 'undefined' ) { w.gtag = noopfn; }
})();`;

for (const [name, src] of Object.entries(resources)) {
  console.log(name + '=' + Buffer.from(src).toString('base64'));
}
