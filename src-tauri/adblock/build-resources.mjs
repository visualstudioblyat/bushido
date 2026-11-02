#!/usr/bin/env node
/**
 * build-resources.mjs — Generates scriptlet-resources.json for adblock-rust
 *
 * Reads uBlock Origin scriptlet source files and transforms them
 * into the adblock-rust Resource JSON format.
 *
 * Usage:
 *   1. git clone --depth 1 https://github.com/gorhill/uBlock.git /tmp/ubo-scriptlets
 *   2. UBO_DIR=/tmp/ubo-scriptlets node build-resources.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const b = s => Buffer.from(s).toString('base64');

const UBO_DIR = process.env.UBO_DIR || resolve('/tmp/ubo-scriptlets');
const SCRIPTLETS_DIR = join(UBO_DIR, 'src/js/resources');
const REDIRECTS_DIR = join(UBO_DIR, 'src/web_accessible_resources');

if (!existsSync(SCRIPTLETS_DIR)) {
  console.error('uBO not found at', SCRIPTLETS_DIR);
  process.exit(1);
}

const jsFiles = [
  'base.js', 'safe-self.js', 'proxy-apply.js', 'run-at.js', 'stack-trace.js',
  'utils.js', 'cookie.js', 'localstorage.js', 'set-constant.js', 'parse-replace.js',
  'object-prune.js', 'json-prune.js', 'json-edit.js', 'shared.js',
  'prevent-fetch.js', 'prevent-xhr.js', 'prevent-settimeout.js',
  'prevent-addeventlistener.js', 'prevent-innerHTML.js', 'prevent-dialog.js',
  'attribute.js', 'create-html.js', 'href-sanitizer.js', 'noeval.js',
  'replace-argument.js', 'spoof-css.js', 'scriptlets.js'
];

// ── PASS 1: Build fnName → scriptlet name map ──────────────────────────────
const fnNameMap = new Map();
const fileSources = new Map();

for (const file of jsFiles) {
  const filePath = join(SCRIPTLETS_DIR, file);
  if (!existsSync(filePath)) continue;
  const src = readFileSync(filePath, 'utf8');
  fileSources.set(file, src);

  for (const m of src.matchAll(/registerScriptlet\(\s*(\w+)\s*,\s*\{[^}]*?name:\s*'([^']*)'/gs)) {
    fnNameMap.set(m[1], m[2]);
  }
  for (const m of src.matchAll(/builtinScriptlets\.push\(\{[^}]*?name:\s*'([^']*)'[^}]*?fn:\s*(\w+)/gs)) {
    fnNameMap.set(m[2], m[1]);
  }
}

console.log(`Built fnNameMap with ${fnNameMap.size} entries`);

// ── Helper functions ────────────────────────────────────────────────────────
function extractString(str, key) {
  const m = str.match(new RegExp(`${key}:\\s*'([^']*)'`));
  return m ? m[1] : null;
}

function extractStringArray(str, key) {
  const m = str.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
  if (!m) return [];
  return [...m[1].matchAll(/'([^']*)'/g)].map(x => x[1]);
}

function resolveDeps(str) {
  const m = str.match(/dependencies:\s*\[([^\]]*)\]/);
  if (!m) return [];
  const inner = m[1].trim();
  if (!inner) return [];

  const deps = [];
  for (const item of inner.split(',').map(s => s.trim()).filter(Boolean)) {
    const strMatch = item.match(/^'([^']*)'$/);
    if (strMatch) {
      deps.push(strMatch[1]);
    } else {
      // Function reference — resolve via fnNameMap
      const resolved = fnNameMap.get(item);
      if (resolved) deps.push(resolved);
      else console.warn(`  Unresolved dep: ${item}`);
    }
  }
  return deps;
}

function extractFunctionSource(src, fnName) {
  if (!fnName) return null;

  const patterns = [
    new RegExp(`(?:export\\s+)?function\\s+${fnName}\\s*\\(`),
    new RegExp(`(?:export\\s+)?const\\s+${fnName}\\s*=\\s*\\(`),
  ];

  for (const pattern of patterns) {
    const m = pattern.exec(src);
    if (!m) continue;

    const startIdx = m.index;
    let braceStart = src.indexOf('{', startIdx + m[0].length);
    if (braceStart === -1) continue;

    let depth = 0;
    let i = braceStart;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { depth--; if (depth === 0) break; }
    }

    if (depth === 0) {
      return src.substring(startIdx, i + 1);
    }
  }
  return null;
}

// ── PASS 2: Parse all registrations ─────────────────────────────────────────
const allRegistrations = [];

for (const file of jsFiles) {
  const src = fileSources.get(file);
  if (!src) continue;

  // registerScriptlet() calls (new style)
  const registerPattern = /registerScriptlet\(\s*(\w+)\s*,\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}\s*\)/gs;
  let m;
  while ((m = registerPattern.exec(src)) !== null) {
    const fnName = m[1];
    const detailsStr = m[2];
    const name = extractString(detailsStr, 'name');
    if (!name) continue;

    allRegistrations.push({
      name,
      aliases: extractStringArray(detailsStr, 'aliases'),
      dependencies: resolveDeps(detailsStr),
      requiresTrust: detailsStr.includes('requiresTrust') && detailsStr.includes('true'),
      fnSrc: extractFunctionSource(src, fnName),
      fnName,
    });
  }

  // builtinScriptlets.push() calls (old style)
  const pushPattern = /builtinScriptlets\.push\(\{([^}]+(?:\{[^}]*\}[^}]*)*)\}\)/gs;
  while ((m = pushPattern.exec(src)) !== null) {
    const detailsStr = m[1];
    const name = extractString(detailsStr, 'name');
    if (!name) continue;

    const fnMatch = detailsStr.match(/fn:\s*(\w+)/);
    const fnName = fnMatch ? fnMatch[1] : null;

    allRegistrations.push({
      name,
      aliases: extractStringArray(detailsStr, 'aliases'),
      dependencies: extractStringArray(detailsStr, 'dependencies'),
      requiresTrust: detailsStr.includes('requiresTrust') && detailsStr.includes('true'),
      fnSrc: fnName ? extractFunctionSource(src, fnName) : null,
      fnName,
    });
  }
}

console.log(`Found ${allRegistrations.length} scriptlet registrations`);

// ── Build Resource objects ──────────────────────────────────────────────────
const resources = [];

for (const reg of allRegistrations) {
  if (!reg.name) continue;

  const isFn = reg.name.endsWith('.fn');

  const resource = {
    name: reg.name,
    aliases: reg.aliases || [],
    kind: isFn ? { mime: 'fn/javascript' } : { mime: 'application/javascript' },
    content: b(reg.fnSrc || `function ${reg.fnName || 'noop'}() {}`),
    dependencies: reg.dependencies || [],
  };

  if (reg.requiresTrust) {
    resource.permission = 1;
  }

  resources.push(resource);
}

// ── Add redirect resources (web_accessible_resources) ───────────────────────
const REDIRECT_ALIASES = {
  'noop.js': ['noopjs'],
  'noop.html': ['noopframe'],
  'noop.txt': ['nooptext'],
  'noop.css': ['noopcss'],
  'noop.json': ['noopjson'],
  '1x1.gif': ['1x1-transparent.gif', '1x1-transparent-gif'],
  '2x2.png': ['2x2-transparent.png', '2x2-transparent-png'],
  '3x2.png': ['3x2-transparent.png', '3x2-transparent-png'],
  '32x32.png': ['32x32-transparent.png', '32x32-transparent-png'],
  'noop-0.1s.mp3': ['noopmp3-0.1s', 'abp-resource:blank-mp3'],
  'noop-0.5s.mp3': [],
  'noop-1s.mp4': ['noopmp4-1s', 'abp-resource:blank-mp4'],
  'noop-vmap1.xml': ['noop-vmap1.0', 'noop-vmap1.0.xml'],
  'noop-vast2.xml': ['noopvast-2.0', 'noopvast2-0'],
  'noop-vast3.xml': ['noopvast-3.0', 'noopvast3-0'],
  'noop-vast4.xml': ['noopvast-4.0', 'noopvast4-0'],
  'click2load.html': [],
  'empty': [],
  'googlesyndication_adsbygoogle.js': ['googlesyndication.com/adsbygoogle.js'],
  'googletagservices_gpt.js': ['googletagservices.com/gpt.js'],
  'google-analytics_analytics.js': ['google-analytics.com/analytics.js', 'googletagmanager.com/gtag/js'],
  'google-analytics_ga.js': ['google-analytics.com/ga.js'],
  'google-analytics_inpage_linkid.js': ['google-analytics.com/inpage_linkid.js'],
  'google-analytics_cx_api.js': ['google-analytics.com/cx/api.js'],
  'google-ima.js': ['google-ima3'],
  'googletagmanager_gtm.js': ['googletagmanager.com/gtm.js'],
  'scorecardresearch_beacon.js': ['scorecardresearch.com/beacon.js'],
  'outbrain-widget.js': ['widgets.outbrain.com/outbrain.js'],
  'amazon_ads.js': ['amazon-adsystem.com/aax2/amzn_ads.js'],
  'amazon_apstag.js': [],
  'ampproject_v0.js': ['ampproject.org/v0.js'],
  'chartbeat.js': ['static.chartbeat.com/chartbeat.js'],
  'doubleclick_instream_ad_status.js': ['doubleclick.net/instream/ad_status.js'],
  'hd-main.js': [],
  'nobab.js': ['bab-defuser.js', 'prevent-bab.js'],
  'nobab2.js': [],
  'noeval.js': [],
  'noeval-silent.js': ['silent-noeval.js'],
  'nofab.js': ['fuckadblock.js-3.2.0'],
  'popads.js': ['popads.net.js', 'prevent-popads-net.js'],
  'popads-dummy.js': [],
  'prebid-ads.js': [],
  'fingerprint2.js': [],
  'fingerprint3.js': [],
  'adthrive_abd.js': [],
  'nitropay_ads.js': [],
  'sensors-analytics.js': [],
};

const MIME_MAP = {
  '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css',
  '.txt': 'text/plain', '.json': 'application/json', '.gif': 'image/gif',
  '.png': 'image/png', '.mp3': 'audio/mp3', '.mp4': 'video/mp4', '.xml': 'text/xml',
};

const existingNames = new Set(resources.map(r => r.name));

for (const [filename, aliases] of Object.entries(REDIRECT_ALIASES)) {
  const filePath = join(REDIRECTS_DIR, filename);
  if (!existsSync(filePath)) { console.warn('Missing redirect:', filename); continue; }
  if (existingNames.has(filename)) continue;

  const ext = '.' + filename.split('.').pop();
  const mime = filename === 'empty' ? 'text/plain' : (MIME_MAP[ext] || 'application/octet-stream');

  resources.push({
    name: filename,
    aliases,
    kind: { mime },
    content: readFileSync(filePath).toString('base64'),
    dependencies: [],
  });
}

// ── Write output ────────────────────────────────────────────────────────────
writeFileSync(join(import.meta.dirname, 'scriptlet-resources.json'), JSON.stringify(resources, null, 2));

const fnCount = resources.filter(r => r.name.endsWith('.fn')).length;
const trustedCount = resources.filter(r => r.permission).length;
const redirectCount = resources.length - allRegistrations.length;
console.log(`Written ${resources.length} resources`);
console.log(`  fn/javascript utilities: ${fnCount}`);
console.log(`  Scriptlets: ${allRegistrations.length - fnCount}`);
console.log(`  Trusted: ${trustedCount}`);
console.log(`  Redirects: ${redirectCount}`);
