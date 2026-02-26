(function() {
    'use strict';
    if (window.__bushidoSP) return;
    Object.defineProperty(window, '__bushidoSP', { value: true, writable: false, configurable: false });

    // cache pristine native APIs at document_start so scriptlets can trust them
    // even if injected slightly later (ContentLoading timing)
    var n = {
        defineProperty: Object.defineProperty,
        defineProperties: Object.defineProperties,
        getOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
        keys: Object.keys,
        reflectApply: Reflect.apply,
        fnToString: Function.prototype.toString,
        arrayIsArray: Array.isArray,
        jsonParse: JSON.parse,
        jsonStringify: JSON.stringify,
    };
    Object.freeze(n);
    Object.defineProperty(window, '__bushidoNatives', { value: n, writable: false, configurable: false, enumerable: false });
})();
