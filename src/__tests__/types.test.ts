import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../types";
import type { BushidoSettings } from "../types";

describe("DEFAULT_SETTINGS", () => {
  it("has all required keys", () => {
    const keys: (keyof BushidoSettings)[] = [
      "searchEngine", "customSearchUrl", "onStartup", "showTopSites",
      "showClock", "showGreeting", "downloadLocation", "askDownloadLocation",
      "httpsOnly", "adBlocker", "cookieAutoReject", "clearDataOnExit",
      "compactMode", "suspendTimeout", "disableDevTools", "disableStatusBar",
      "disableAutofill", "disablePasswordSave", "blockServiceWorkers",
      "blockFontEnumeration", "spoofHardwareConcurrency", "onboardingComplete",
      "accentColor", "themeMode", "syncEnabled", "syncDeviceName",
      "topSiteRows", "suspendExcludedUrls", "selectRecentTabOnClose",
      "confirmCloseMultiple", "customHomepageUrl", "defaultZoom", "zoomHistory",
      "readerFontSize", "readerFont", "readerTheme", "readerLineWidth",
      "confirmBeforeQuit", "searchSuggestions", "blockPopups", "autoplayPolicy",
      "dnsLevel", "showMediaControls", "showDomainOnly", "keybindings",
      "maxTabs", "bandwidthLimit", "mimeRouting", "vaultAutoLock",
      "vaultLockTimeout", "syncDataTypes",
    ];
    for (const key of keys) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });

  it("has valid search engine default", () => {
    expect(["google", "duckduckgo", "brave", "bing", "custom"]).toContain(DEFAULT_SETTINGS.searchEngine);
  });

  it("has valid theme mode", () => {
    expect(["dark", "light"]).toContain(DEFAULT_SETTINGS.themeMode);
  });

  it("has reasonable numeric defaults", () => {
    expect(DEFAULT_SETTINGS.defaultZoom).toBe(100);
    expect(DEFAULT_SETTINGS.maxTabs).toBeGreaterThanOrEqual(10);
    expect(DEFAULT_SETTINGS.maxTabs).toBeLessThanOrEqual(200);
    expect(DEFAULT_SETTINGS.suspendTimeout).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SETTINGS.readerFontSize).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.readerLineWidth).toBeGreaterThan(0);
  });

  it("has all standard keybindings", () => {
    const expected = [
      "new-tab", "close-tab", "reopen-tab", "next-tab", "prev-tab",
      "focus-url", "find", "command-palette", "reload", "fullscreen",
      "bookmark", "history", "downloads", "toggle-sidebar", "toggle-compact",
      "reader-mode", "devtools", "split-view", "print", "screenshot",
      "zoom-in", "zoom-out", "zoom-reset",
    ];
    for (const action of expected) {
      expect(DEFAULT_SETTINGS.keybindings).toHaveProperty(action);
    }
  });

  it("has mime routing defaults", () => {
    expect(DEFAULT_SETTINGS.mimeRouting.length).toBeGreaterThanOrEqual(4);
    const prefixes = DEFAULT_SETTINGS.mimeRouting.map(r => r.mimePrefix);
    expect(prefixes).toContain("image/");
    expect(prefixes).toContain("video/");
    expect(prefixes).toContain("audio/");
    expect(prefixes).toContain("application/pdf");
  });
});
