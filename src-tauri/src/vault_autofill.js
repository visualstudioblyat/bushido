(function() {
  if (window.__bushidoVault) return;
  window.__bushidoVault = true;

  var postMsg = window.chrome && window.chrome.webview
    ? function(data) { window.chrome.webview.postMessage(JSON.stringify(data)); }
    : function() {};

  var STORAGE_KEY = '__bushidoVaultUser';
  var pendingSave = null;
  var DBG = true;
  // track last known password value — some sites clear the field before our handler runs
  var lastPwValue = '';
  var lastPwDomain = '';
  // in-memory username cache — survives SPA nav within same webview (sessionStorage is per-origin)
  var lastUsername = '';
  function vlog() { if (DBG) console.log('[vault]', ...arguments); }

  function findLoginForms() {
    // type="password" + autocomplete="current-password"/"new-password" + common name attrs
    var pwFields = document.querySelectorAll(
      'input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"], ' +
      'input[name="Passwd"], input[name="passwd"], input[name="password"], input[name="pass"]'
    );
    var seen = new Set();
    var forms = [];
    pwFields.forEach(function(pw) {
      if (seen.has(pw)) return;
      seen.add(pw);
      // skip hidden decoy fields
      if (pw.tabIndex === -1 && pw.getAttribute('aria-hidden') === 'true') return;
      // skip invisible fields (display:none, visibility:hidden, zero size)
      if (pw.offsetWidth === 0 && pw.offsetHeight === 0 && !pw.offsetParent) return;
      var user = findUsernameField(pw);
      if (user || pw) forms.push({ user: user, pass: pw });
    });
    return forms;
  }

  // walk backwards through siblings/parent to find username/email field
  function findUsernameField(pwField) {
    var form = pwField.closest('form');
    var scope = form || pwField.parentElement;
    if (!scope) return null;
    // also match autocomplete="username" / "email"
    var inputs = scope.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="tel"], input:not([type]), ' +
      'input[autocomplete="username"], input[autocomplete="email"]'
    );
    var candidates = [];
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp === pwField || inp.type === 'hidden' || inp.type === 'password') continue;
      var name = ((inp.name || '') + (inp.id || '') + (inp.autocomplete || '') + (inp.placeholder || '')).toLowerCase();
      if (/user|email|login|account|name|identifier/.test(name)) return inp;
      candidates.push(inp);
    }
    for (var j = candidates.length - 1; j >= 0; j--) {
      if (candidates[j].compareDocumentPosition(pwField) & Node.DOCUMENT_POSITION_FOLLOWING) {
        return candidates[j];
      }
    }
    return candidates[0] || null;
  }

  // find any visible email/username input on page (for multi-step flows)
  function findEmailOnPage() {
    // broad: any visible text/email input with a value
    var inputs = document.querySelectorAll('input[type="email"], input[type="text"], input[type="tel"], input:not([type])');
    for (var i = 0; i < inputs.length; i++) {
      var inp = inputs[i];
      if (inp.type === 'hidden' || inp.tabIndex === -1) continue;
      // skip invisible
      if (!inp.offsetParent && inp.offsetWidth === 0) continue;
      var name = ((inp.name || '') + (inp.id || '') + (inp.autocomplete || '') + (inp.getAttribute('aria-label') || '')).toLowerCase();
      if (/user|email|login|account|identifier|phone|name/.test(name) && inp.value) {
        vlog('findEmailOnPage: found', inp.name || inp.id, '=', inp.value);
        return inp.value;
      }
    }
    // fallback: any visible focused input with a value that looks like email/username
    var active = document.activeElement;
    if (active && active.tagName === 'INPUT' && active.value && active.type !== 'password' && active.type !== 'hidden') {
      vlog('findEmailOnPage: fallback from activeElement', active.value);
      return active.value;
    }
    return '';
  }

  // store username across pages (google-style multi step)
  function storeUsername(val) {
    if (val) {
      lastUsername = val; // in-memory — survives cross-origin SPA nav in same webview
      try { sessionStorage.setItem(STORAGE_KEY, val); } catch(e) {}
    }
  }

  function getStoredUsername() {
    var ss = '';
    try { ss = sessionStorage.getItem(STORAGE_KEY) || ''; } catch(e) {}
    return ss || lastUsername; // fall back to in-memory cache
  }

  // track email fields on pages without password (first step of multi-step login)
  function watchEmailPage() {
    var email = findEmailOnPage();
    vlog('watchEmailPage: found email:', email || '(none)');
    if (email) storeUsername(email);

    // watch for clicks — store whatever's in the email field before page navigates
    document.addEventListener('click', function() {
      var email = findEmailOnPage();
      if (email) { vlog('watchEmailPage click: storing', email); storeUsername(email); }
    }, true);

    // also store on Enter key (google "Next" via keyboard)
    document.addEventListener('keydown', function(ev) {
      if (ev.key === 'Enter') {
        var email = findEmailOnPage();
        if (email) { vlog('watchEmailPage enter: storing', email); storeUsername(email); }
      }
    }, true);

    // watch email/username inputs as user types (captures before navigation)
    var emailInputs = document.querySelectorAll('input[type="email"], input[autocomplete="username"], input[id*="dentifier" i], input[name*="mail" i]');
    emailInputs.forEach(function(inp) {
      if (inp.__bushidoEmailWatched) return;
      inp.__bushidoEmailWatched = true;
      inp.addEventListener('input', function() {
        if (inp.value) { storeUsername(inp.value); }
      });
    });
  }

  // shadow dom dropdown for credential selection
  var dropdownHost = null;
  var dropdownRoot = null;

  function createDropdown() {
    if (dropdownHost) return;
    dropdownHost = document.createElement('div');
    dropdownHost.style.cssText = 'position:absolute;z-index:2147483647;';
    document.body.appendChild(dropdownHost);
    dropdownRoot = dropdownHost.attachShadow({ mode: 'closed' });
  }

  function showDropdown(anchorEl, entries, onSelect) {
    createDropdown();
    var rect = anchorEl.getBoundingClientRect();
    dropdownHost.style.left = (rect.left + window.scrollX) + 'px';
    dropdownHost.style.top = (rect.bottom + window.scrollY + 2) + 'px';
    dropdownHost.style.width = Math.max(rect.width, 240) + 'px';

    var html = '<style>' +
      ':host{all:initial}' +
      '.bv-dd{background:#1a1a2e;border:1px solid #333;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,.5);font-family:system-ui;overflow:hidden}' +
      '.bv-item{padding:10px 14px;cursor:pointer;display:flex;flex-direction:column;gap:2px;border-bottom:1px solid #222}' +
      '.bv-item:last-child{border-bottom:none}' +
      '.bv-item:hover,.bv-item.bv-active{background:#262640}' +
      '.bv-user{color:#e2e8f0;font-size:13px;font-weight:500}' +
      '.bv-pass{color:#818cf8;font-size:11px}' +
      '.bv-hdr{padding:8px 14px;color:#818cf8;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #222}' +
      '</style>' +
      '<div class="bv-dd">' +
      '<div class="bv-hdr">Bushido Vault</div>';

    entries.forEach(function(e, i) {
      html += '<div class="bv-item" data-idx="' + i + '">' +
        '<span class="bv-user">' + escapeHtml(e.username) + '</span>' +
        '<span class="bv-pass">' + '\u2022'.repeat(8) + '</span>' +
        '</div>';
    });
    html += '</div>';
    dropdownRoot.innerHTML = html;

    var activeIdx = 0;
    var items = dropdownRoot.querySelectorAll('.bv-item');
    if (items[0]) items[0].classList.add('bv-active');

    items.forEach(function(item) {
      item.addEventListener('mousedown', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var idx = parseInt(item.dataset.idx);
        onSelect(entries[idx]);
        hideDropdown();
      });
    });

    function onKey(ev) {
      if (ev.key === 'Escape') { hideDropdown(); document.removeEventListener('keydown', onKey, true); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        items[activeIdx].classList.remove('bv-active');
        activeIdx = ev.key === 'ArrowDown' ? (activeIdx + 1) % items.length : (activeIdx - 1 + items.length) % items.length;
        items[activeIdx].classList.add('bv-active');
        items[activeIdx].scrollIntoView({ block: 'nearest' });
      }
      if (ev.key === 'Enter' && entries[activeIdx]) {
        ev.preventDefault();
        onSelect(entries[activeIdx]);
        hideDropdown();
        document.removeEventListener('keydown', onKey, true);
      }
    }
    document.addEventListener('keydown', onKey, true);

    setTimeout(function() {
      document.addEventListener('mousedown', function dismiss(ev) {
        if (dropdownHost && !dropdownHost.contains(ev.target)) {
          hideDropdown();
          document.removeEventListener('mousedown', dismiss);
        }
      });
    }, 50);
  }

  function hideDropdown() {
    if (dropdownHost && dropdownHost.parentNode) {
      dropdownHost.parentNode.removeChild(dropdownHost);
      dropdownHost = null;
      dropdownRoot = null;
    }
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function fillFields(userField, passField, username, password) {
    if (userField) setNativeValue(userField, username);
    if (passField) setNativeValue(passField, password);
  }

  // set value + dispatch events so frameworks pick it up
  function setNativeValue(el, val) {
    var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function trySavePrompt() {
    var forms = findLoginForms();
    vlog('trySavePrompt: found', forms.length, 'forms');
    for (var i = 0; i < forms.length; i++) {
      var pw = forms[i].pass;
      // use field value, or fall back to cached value (google clears field on submit)
      var pwValue = (pw && pw.value) ? pw.value : lastPwValue;
      vlog('  form', i, 'pw:', pw ? pw.type : 'null', 'field:', pw && pw.value ? pw.value.length + ' chars' : 'empty', 'cached:', lastPwValue.length, 'chars');
      if (!pwValue) continue;
      var userField = forms[i].user;
      var username = userField ? userField.value : getStoredUsername();
      if (!username) username = getStoredUsername();
      vlog('  username:', username || '(none)', 'stored:', getStoredUsername() || '(none)');
      var key = location.hostname + '|' + username + '|' + pwValue;
      if (pendingSave === key) { vlog('  dedupe skip'); return; }
      pendingSave = key;
      vlog('  SENDING vault-save-prompt for', location.hostname, username);
      postMsg({
        __bushido: 'vault-save-prompt',
        domain: location.hostname,
        username: username,
        password: pwValue,
      });
      return;
    }
    // no forms found but we have a cached password (page navigated away from login)
    if (lastPwValue && lastPwDomain === location.hostname) {
      var username = getStoredUsername();
      vlog('trySavePrompt: using cached pw, no forms. user:', username);
      if (!username) return;
      var key = location.hostname + '|' + username + '|' + lastPwValue;
      if (pendingSave === key) return;
      pendingSave = key;
      vlog('  SENDING vault-save-prompt (cached) for', location.hostname, username);
      postMsg({
        __bushido: 'vault-save-prompt',
        domain: location.hostname,
        username: username,
        password: lastPwValue,
      });
    }
  }

  // listen for fill options from rust
  window.addEventListener('message', function(ev) {
    if (!ev.data || typeof ev.data !== 'object') return;
    if (ev.data.__bushidoVaultFill && ev.data.entries) {
      var entries = ev.data.entries;
      if (!entries.length) return;
      var forms = findLoginForms();
      if (!forms.length) return;
      var form = forms[0];
      var anchor = form.user || form.pass;

      if (entries.length === 1 && form.user) {
        fillFields(form.user, form.pass, entries[0].username, entries[0].password);
      } else {
        showDropdown(anchor, entries, function(entry) {
          fillFields(form.user, form.pass, entry.username, entry.password);
        });
      }
    }
  });

  function checkDomain() {
    var forms = findLoginForms();
    vlog('checkDomain:', location.hostname, 'forms:', forms.length);
    if (forms.length > 0) {
      postMsg({ __bushido: 'vault-check', domain: location.hostname });
    }
  }

  function snapshotPassword() {
    var forms = findLoginForms();
    for (var i = 0; i < forms.length; i++) {
      var pw = forms[i].pass;
      if (pw && pw.value) {
        lastPwValue = pw.value;
        lastPwDomain = location.hostname;
        return;
      }
    }
  }

  // attach input listeners to password fields — capture value as user types
  function watchPasswordInputs() {
    var forms = findLoginForms();
    forms.forEach(function(f) {
      if (f.pass && !f.pass.__bushidoWatched) {
        f.pass.__bushidoWatched = true;
        vlog('watching pw field:', f.pass.name || f.pass.type);
        f.pass.addEventListener('input', function() {
          if (f.pass.value) {
            lastPwValue = f.pass.value;
            lastPwDomain = location.hostname;
            vlog('pw input captured:', f.pass.value.length, 'chars');
          }
        });
        // also poll via keyup for sites that intercept input events
        f.pass.addEventListener('keyup', function() {
          if (f.pass.value) {
            lastPwValue = f.pass.value;
            lastPwDomain = location.hostname;
          }
        });
        // grab current value if already filled
        if (f.pass.value) {
          lastPwValue = f.pass.value;
          lastPwDomain = location.hostname;
        }
      }
    });
  }

  // fire save prompt from cached values when forms are already gone (post-submit SPA navigation)
  function trySaveFromCache() {
    if (!lastPwValue || !lastPwDomain) return;
    // only fire if we're still on the same domain (or a subdomain/sibling)
    var baseDomain = lastPwDomain.replace(/^(accounts|login|signin|auth|sso|id)\./, '');
    var currentBase = location.hostname.replace(/^(accounts|login|signin|auth|sso|id|www|mail)\./, '');
    if (baseDomain !== currentBase && location.hostname !== lastPwDomain) return;
    var username = getStoredUsername();
    if (!username) return;
    var key = lastPwDomain + '|' + username + '|' + lastPwValue;
    if (pendingSave === key) return;
    pendingSave = key;
    vlog('SENDING vault-save-prompt (cached) for', lastPwDomain, username);
    postMsg({
      __bushido: 'vault-save-prompt',
      domain: lastPwDomain,
      username: username,
      password: lastPwValue,
    });
  }

  function watchSubmissions() {
    // native form submit
    document.addEventListener('submit', function() {
      snapshotPassword();
      trySavePrompt();
    }, true);

    // any click when a password is known — fire IMMEDIATELY then also after delay
    document.addEventListener('click', function() {
      snapshotPassword();
      if (!lastPwValue) return;
      vlog('click with pw cached:', lastPwValue.length, 'chars');
      trySavePrompt(); // immediate — before Google clears the field
      setTimeout(trySavePrompt, 100); // delayed fallback
    }, true);

    // enter key in password field
    document.addEventListener('keydown', function(ev) {
      if (ev.key !== 'Enter') return;
      snapshotPassword();
      var active = document.activeElement;
      if (!active || active.tagName !== 'INPUT') return;
      var isPasswd = active.type === 'password' || /^(passwd|password|pass)$/i.test(active.name);
      if ((isPasswd && active.value) || lastPwValue) {
        if (active.value) { lastPwValue = active.value; lastPwDomain = location.hostname; }
        trySavePrompt(); // immediate
        setTimeout(trySavePrompt, 100); // delayed fallback
      }
    }, true);

    // beforeunload — last chance to catch creds before navigation
    window.addEventListener('beforeunload', function() {
      snapshotPassword();
      trySavePrompt();
    });
  }

  // watch for dynamically added/removed password fields + email fields
  var hadPasswordFields = false;
  var mutDebounce = null;
  function watchDynamicForms() {
    var target = document.documentElement || document.body;
    if (!target) return;
    new MutationObserver(function() {
      // debounce — Google triggers hundreds of mutations on load
      if (mutDebounce) return;
      mutDebounce = setTimeout(function() {
        mutDebounce = null;
        var forms = findLoginForms();
        if (forms.length > 0) {
          hadPasswordFields = true;
          checkDomain();
          watchPasswordInputs();
        } else if (hadPasswordFields && lastPwValue) {
          // password fields just disappeared (SPA navigation after submit)
          hadPasswordFields = false;
          vlog('password fields disappeared — firing cached save prompt');
          setTimeout(trySaveFromCache, 200);
        }
        // also re-scan for email fields (multi-step login like Google)
        var email = findEmailOnPage();
        if (email && email !== getStoredUsername()) {
          vlog('MutationObserver found email:', email);
          storeUsername(email);
        }
      }, 200);
    }).observe(target, { childList: true, subtree: true });
  }

  // run
  function init() {
    setTimeout(checkDomain, 500);
    setTimeout(checkDomain, 2000); // retry for JS-heavy sites (Google, etc.)
    watchSubmissions();
    watchEmailPage();
    watchDynamicForms();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // SPA navigation
  var lastUrl = location.href;
  var spaTarget = document.documentElement || document.body;
  if (spaTarget) {
    new MutationObserver(function() {
      if (location.href !== lastUrl) {
        var oldUrl = lastUrl;
        lastUrl = location.href;
        hideDropdown();
        // try save from cache BEFORE resetting pendingSave (URL changed = likely form submitted)
        if (lastPwValue) {
          vlog('SPA nav detected with cached pw, trying save');
          trySaveFromCache();
        }
        pendingSave = null;
        setTimeout(checkDomain, 500);
        watchEmailPage();
      }
    }).observe(spaTarget, { childList: true, subtree: true });
  }
  // expose retry hook for post-unlock flow (called from Rust after vault unlock)
  window.__bushidoVaultRetry = function() {
    vlog('vault retry triggered');
    checkDomain();
    watchPasswordInputs();
  };
})();
