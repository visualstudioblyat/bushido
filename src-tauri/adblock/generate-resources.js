const fs = require('fs');
const path = require('path');

function b64(str) {
  return Buffer.from(str).toString('base64');
}

const resources = [
  // 1. noop.js
  {
    name: "noop.js",
    aliases: ["noopjs"],
    kind: { mime: "application/javascript" },
    content: b64("(function() {})()"),
    dependencies: [],
    permission: 0
  },
  // 2. noop.html
  {
    name: "noop.html",
    aliases: ["noopframe"],
    kind: { mime: "text/html" },
    content: b64("<!DOCTYPE html>"),
    dependencies: [],
    permission: 0
  },
  // 3. noop.txt
  {
    name: "noop.txt",
    aliases: ["nooptext"],
    kind: { mime: "text/plain" },
    content: b64(" "),
    dependencies: [],
    permission: 0
  },
  // 4. 1x1-transparent.gif
  {
    name: "1x1-transparent.gif",
    aliases: ["1x1.gif", "1x1-transparent-gif"],
    kind: { mime: "image/gif" },
    content: "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    dependencies: [],
    permission: 0
  },
  // 5. 2x2-transparent.png
  {
    name: "2x2-transparent.png",
    aliases: ["2x2.png", "2x2-transparent-png"],
    kind: { mime: "image/png" },
    content: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVQI12NgAAIAASAAGeel2OYAAAAASUVORK5CYII=",
    dependencies: [],
    permission: 0
  },
  // 3x2-transparent.png
  {
    name: "3x2-transparent.png",
    aliases: ["3x2.png", "3x2-transparent-png"],
    kind: { mime: "image/png" },
    content: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAC0lEQVQI12NgwAUAABoAASRETuUAAAAASUVORK5CYII=",
    dependencies: [],
    permission: 0
  },
  // 32x32-transparent.png
  {
    name: "32x32-transparent.png",
    aliases: ["32x32.png", "32x32-transparent-png"],
    kind: { mime: "image/png" },
    content: "iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVRYR+3BAQEAAACCIP+vbkhAAQAAAADvBhAgAAFvnyqBAAAAAElFTkSuQmCC",
    dependencies: [],
    permission: 0
  },
  // 6. noopmp3-0.1s
  {
    name: "noopmp3-0.1s",
    aliases: ["noop-0.1s.mp3"],
    kind: { mime: "audio/mp3" },
    content: "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhgistEwAAAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAABhgistEwAAAAAAAAAAAAAAAAA",
    dependencies: [],
    permission: 0
  },
  // 7. noopmp4-1s
  {
    name: "noopmp4-1s",
    aliases: ["noop-1s.mp4"],
    kind: { mime: "video/mp4" },
    content: "AAAAHGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAQhtb292AAAAbG12aGQAAAAA1NIGzNTSBswAAV+QAABY4AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAFGlvZHMAAAAAEAAAAAAAAQAAABdtZGhkAAAAANTSBszU0gbMAAAD6AAAA+gABQAAAAAAAC1oZGxyAAAAAAAAAABzb3VuAAAAAAAAAAAAAAAAU291bmRIYW5kbGVyAAAAAWNtaW5mAAAAEHNtaGQAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABJ3N0YmwAAABnc3RzZAAAAAAAAAABAAAAV21wNGEAAAAAAAAAAQAAAAAAAAAAAAIAEAAAAAD6AAAAAAAAACBlc2RzAAAAAAOAgIAiAAIABICAgBRAFQAAAAAAAAAAAAAABYCAgAISCAaAgIABAgAAABhzdHRzAAAAAAAAAAEAAAABAAAD6AAAABxzdHNjAAAAAAAAAAEAAAABAAAAAQAAAAEAAAAUc3RzegAAAAAAAAIkAAAAAQAAABRzdGNvAAAAAAAAAAEAAAAsAAAAYnVkdGEAAABabWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAtaWxzdAAAACWpdG9vAAAAHWRhdGEAAAABAAAAAExhdmY1OC43Ni4xMDA=",
    dependencies: [],
    permission: 0
  },
  // 8. noop-vmap1.0.xml
  {
    name: "noop-vmap1.0.xml",
    aliases: ["noop-vmap1.0"],
    kind: { mime: "text/xml" },
    content: b64('<VMAP xmlns="http://www.iab.net/vmap-1.0" version="1.0"></VMAP>'),
    dependencies: [],
    permission: 0
  },
  // 9. click2load.html
  {
    name: "click2load.html",
    aliases: [],
    kind: { mime: "text/html" },
    content: b64('<html><body style="display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font:14px sans-serif;background:#f5f5f5;color:#333"><div style="text-align:center;padding:20px"><p>Content blocked for privacy.</p><button onclick="window.location.reload()" style="padding:8px 16px;cursor:pointer;border:1px solid #ccc;border-radius:4px;background:#fff">Click to load</button></div></body></html>'),
    dependencies: [],
    permission: 0
  },
  // 10. abort-on-property-read.js
  {
    name: "abort-on-property-read.js",
    aliases: ["aopr.js", "abort-on-property-read", "aopr"],
    kind: "template",
    content: b64(`(function() {
  if ( typeof {{1}} === 'undefined' ) return;
  var chain = '{{1}}';
  var owner = window;
  var prop;
  var props = chain.split('.');
  for (;;) {
    prop = props.shift();
    if ( props.length === 0 ) break;
    if ( typeof owner[prop] !== 'object' && typeof owner[prop] !== 'function' ) {
      owner[prop] = {};
    }
    owner = owner[prop];
  }
  var desc = Object.getOwnPropertyDescriptor(owner, prop);
  if ( desc && desc.get !== undefined ) return;
  Object.defineProperty(owner, prop, {
    get: function() { throw new ReferenceError(prop); },
    set: function() {}
  });
})();`),
    dependencies: [],
    permission: 0
  },
  // 11. abort-on-property-write.js
  {
    name: "abort-on-property-write.js",
    aliases: ["aopw.js", "abort-on-property-write", "aopw"],
    kind: "template",
    content: b64(`(function() {
  var chain = '{{1}}';
  var owner = window;
  var prop;
  var props = chain.split('.');
  for (;;) {
    prop = props.shift();
    if ( props.length === 0 ) break;
    if ( typeof owner[prop] !== 'object' && typeof owner[prop] !== 'function' ) {
      owner[prop] = {};
    }
    owner = owner[prop];
  }
  Object.defineProperty(owner, prop, {
    get: function() { return undefined; },
    set: function() { throw new Error('abort'); }
  });
})();`),
    dependencies: [],
    permission: 0
  },
  // 12. abort-current-inline-script.js
  {
    name: "abort-current-inline-script.js",
    aliases: ["acis.js", "abort-current-inline-script", "acis"],
    kind: "template",
    content: b64(`(function() {
  var target = '{{1}}';
  var needle = '{{2}}';
  var reNeedle = needle !== '' && needle !== '{{2}}' ? new RegExp(needle) : null;
  var chain = target.split('.');
  var owner = window;
  var prop;
  for ( var i = 0; i < chain.length - 1; i++ ) {
    owner = owner[chain[i]];
    if ( !owner ) return;
  }
  prop = chain[chain.length - 1];
  var orig = owner[prop];
  var currentScript = null;
  Object.defineProperty(owner, prop, {
    get: function() {
      if ( document.currentScript ) {
        var src = document.currentScript.textContent;
        if ( reNeedle === null || reNeedle.test(src) ) {
          throw new ReferenceError(target);
        }
      }
      return typeof orig === 'function' ? orig.bind(window) : orig;
    },
    set: function(v) { orig = v; }
  });
})();`),
    dependencies: [],
    permission: 0
  },
  // 13. set-constant.js
  {
    name: "set-constant.js",
    aliases: ["set.js", "set-constant", "set"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 14. no-setTimeout-if.js
  {
    name: "no-setTimeout-if.js",
    aliases: ["nostif.js", "no-setTimeout-if", "nostif", "prevent-setTimeout"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 15. no-setInterval-if.js
  {
    name: "no-setInterval-if.js",
    aliases: ["nosiif.js", "no-setInterval-if", "nosiif", "prevent-setInterval"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 16. prevent-addEventListener.js
  {
    name: "prevent-addEventListener.js",
    aliases: ["aeld.js", "prevent-addEventListener", "aeld"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 17. prevent-fetch.js
  {
    name: "prevent-fetch.js",
    aliases: ["no-fetch-if.js", "prevent-fetch", "no-fetch-if"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 18. prevent-xhr.js
  {
    name: "prevent-xhr.js",
    aliases: ["no-xhr-if.js", "prevent-xhr", "no-xhr-if"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 19. json-prune.js
  {
    name: "json-prune.js",
    aliases: ["json-prune"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 20. noeval.js
  {
    name: "noeval.js",
    aliases: ["noeval", "silent-noeval.js", "silent-noeval"],
    kind: "template",
    content: b64(`(function() {
  window.eval = new Proxy(window.eval, {
    apply: function(target, thisArg, args) {
      return;
    }
  });
})();`),
    dependencies: [],
    permission: 0
  },
  // 21. remove-attr.js
  {
    name: "remove-attr.js",
    aliases: ["ra.js", "remove-attr", "ra"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 22. remove-class.js
  {
    name: "remove-class.js",
    aliases: ["rc.js", "remove-class", "rc"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 23. disable-newtab-links.js
  {
    name: "disable-newtab-links.js",
    aliases: ["disable-newtab-links"],
    kind: "template",
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 24. window.name-defuser.js
  {
    name: "window.name-defuser.js",
    aliases: ["window.name-defuser"],
    kind: "template",
    content: b64(`(function() {
  if ( window === window.top ) {
    window.name = '';
  }
})();`),
    dependencies: [],
    permission: 0
  },
  // 25. nowebrtc.js
  {
    name: "nowebrtc.js",
    aliases: ["nowebrtc"],
    kind: "template",
    content: b64(`(function() {
  var rtc = window.RTCPeerConnection || window.webkitRTCPeerConnection;
  if ( !rtc ) return;
  window.RTCPeerConnection = function() { throw new Error('WebRTC blocked'); };
  if ( window.webkitRTCPeerConnection ) {
    window.webkitRTCPeerConnection = window.RTCPeerConnection;
  }
})();`),
    dependencies: [],
    permission: 0
  },
  // 26. set-cookie.js
  {
    name: "set-cookie.js",
    aliases: ["set-cookie"],
    kind: "template",
    content: b64(`(function() {
  var name = '{{1}}';
  var value = '{{2}}';
  if ( name === '' || name === '{{1}}' ) return;
  if ( value === '{{2}}' ) value = '';
  var cookieVal = name + '=' + value + '; path=/; max-age=86400; SameSite=Lax';
  try { document.cookie = cookieVal; } catch(e) {}
})();`),
    dependencies: [],
    permission: 0
  },
  // 27. googlesyndication_adsbygoogle.js
  {
    name: "googlesyndication_adsbygoogle.js",
    aliases: ["googlesyndication.com/adsbygoogle.js"],
    kind: { mime: "application/javascript" },
    content: b64(`(function() {
  var p = { push: function() {} };
  window.adsbygoogle = window.adsbygoogle || p;
  if ( typeof window.adsbygoogle.loaded === 'undefined' ) {
    window.adsbygoogle.loaded = true;
  }
  if ( typeof window.adsbygoogle.push !== 'function' ) {
    window.adsbygoogle.push = function() {};
  }
})();`),
    dependencies: [],
    permission: 0
  },
  // 28. googletagservices_gpt.js
  {
    name: "googletagservices_gpt.js",
    aliases: ["googletagservices.com/gpt.js"],
    kind: { mime: "application/javascript" },
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  },
  // 29. google-analytics_analytics.js
  {
    name: "google-analytics_analytics.js",
    aliases: ["google-analytics.com/analytics.js", "googletagmanager.com/gtag/js"],
    kind: { mime: "application/javascript" },
    content: b64(`(function() {
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
})();`),
    dependencies: [],
    permission: 0
  }
];

const outputPath = path.join(__dirname, 'scriptlet-resources.json');
fs.writeFileSync(outputPath, JSON.stringify(resources, null, 2));
console.log('Written to ' + outputPath);
console.log('Resource count: ' + resources.length);
