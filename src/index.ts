import hljs from 'highlight.js';
import curlLanguage from 'highlightjs-curl';
import iptablesLanguage from 'highlightjs-iptables/src/languages/iptables.js';
import terraformLanguage from 'highlightjs-terraform';
import vbaLanguage from 'highlightjs-vba/src/vba.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Env {
  BUCKET: R2Bucket;
  KV: KVNamespace;
  PASSWORD: string;
  UPLOAD_TTL_HOURS?: string;
}

interface FileMeta {
  name: string;
  type: string;
  size: number;
  uploaded: string; // ISO date
  expires?: string; // ISO date
  ext: string;
  command?: string; // piped command (e.g. "docker logs app")
}

// ─── Config ──────────────────────────────────────────────────────────────────

const DIGITS = '0123456789';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

// ID phases in order: nnn, nnl, nll, lnn, lln, lll
// Phase sizes: 10*10*10=1000, 10*10*26=2600, 10*26*26=6760, 26*10*10=2600, 26*26*10=6760, 26*26*26=17576
// Total: 37,296 IDs
const ID_PHASES: Array<[string, string, string]> = [
  [DIGITS, DIGITS, DIGITS],   // nnn
  [DIGITS, DIGITS, LETTERS],  // nnl
  [DIGITS, LETTERS, LETTERS], // nll
  [LETTERS, DIGITS, DIGITS],  // lnn
  [LETTERS, LETTERS, DIGITS], // lln
  [LETTERS, LETTERS, LETTERS],// lll
];

function indexToId(index: number): string {
  let offset = 0;
  for (const [c1, c2, c3] of ID_PHASES) {
    const phaseSize = c1.length * c2.length * c3.length;
    if (index < offset + phaseSize) {
      const local = index - offset;
      const i3 = local % c3.length;
      const i2 = Math.floor(local / c3.length) % c2.length;
      const i1 = Math.floor(local / (c3.length * c2.length));
      return c1[i1] + c2[i2] + c3[i3];
    }
    offset += phaseSize;
  }
  throw new Error('ID space exhausted');
}

async function generateId(kv: KVNamespace): Promise<string> {
  const raw = await kv.get('next_id_index');
  const index = raw ? parseInt(raw, 10) : 0;
  const id = indexToId(index);
  await kv.put('next_id_index', String(index + 1));
  return id;
}
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const IP_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
const MAX_PREVIEW_SIZE = 2 * 1024 * 1024; // 2 MB for syntax-highlighted preview
const DEFAULT_UPLOAD_TTL_HOURS = 168; // 7 days
const HOUR_MS = 60 * 60 * 1000;
const META_KEY_PREFIX = 'meta:';
const EXPIRY_INDEX_PREFIX = 'expiry:';
const EXPIRY_INDEX_PAGE_SIZE = 1000;
const EXPIRY_BACKFILL_CURSOR_KEY = 'maintenance:expiry_backfill_cursor';
const EXPIRY_BACKFILL_DONE_KEY = 'maintenance:expiry_backfill_done';
const AUTH_MAX_ATTEMPTS = 5;
const AUTH_WINDOW_SECONDS = 5 * 60; // 5 minutes
const AUTH_BAN_SECONDS = 24 * 60 * 60; // 24 hours
const HLJS_VERSION = '11.11.1';
const HLJS_CDN_BASE = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/${HLJS_VERSION}`;
const SUPPORTED_HLJS_LANGUAGE_ROWS: Array<[string, string[]]> = [
  ['1C', ['1c']],
  ['ABNF', ['abnf']],
  ['Access logs', ['accesslog']],
  ['ActionScript', ['actionscript', 'as']],
  ['Ada', ['ada']],
  ['AngelScript', ['angelscript', 'asc']],
  ['Apache', ['apache', 'apacheconf']],
  ['AppleScript', ['applescript', 'osascript']],
  ['Arcade', ['arcade']],
  ['Arduino (C++ w/Arduino libs)', ['arduino', 'ino']],
  ['ARM assembler', ['armasm', 'arm']],
  ['AsciiDoc', ['asciidoc', 'adoc']],
  ['AspectJ', ['aspectj']],
  ['AutoHotkey', ['autohotkey']],
  ['AutoIt', ['autoit']],
  ['AVR assembler', ['avrasm']],
  ['Awk', ['awk', 'mawk', 'nawk', 'gawk']],
  ['Bash', ['bash', 'sh', 'zsh']],
  ['BASIC', ['basic']],
  ['BBCode', ['bbcode']],
  ['BNF', ['bnf']],
  ['Brainfuck', ['brainfuck', 'bf']],
  ['C', ['c', 'h']],
  ['C#', ['csharp', 'cs']],
  ['C++', ['cpp', 'hpp', 'cc', 'hh', 'c++', 'h++', 'cxx', 'hxx']],
  ['C/AL', ['cal']],
  ['Cache Object Script', ['cos', 'cls']],
  ['Cap’n Proto', ['capnproto', 'capnp']],
  ['Clojure', ['clojure', 'clj']],
  ['CMake', ['cmake', 'cmake.in']],
  ['CoffeeScript', ['coffeescript', 'coffee', 'cson', 'iced']],
  ['Coq', ['coq']],
  ['Crmsh', ['crmsh', 'crm', 'pcmk']],
  ['Crystal', ['crystal', 'cr']],
  ['CSP', ['csp']],
  ['CSS', ['css']],
  ['cURL', ['curl']],
  ['D', ['d']],
  ['Dart', ['dart']],
  ['Delphi', ['dpr', 'dfm', 'pas', 'pascal']],
  ['Diff', ['diff', 'patch']],
  ['Django', ['django', 'jinja']],
  ['DNS Zone file', ['dns', 'zone', 'bind']],
  ['Dockerfile', ['dockerfile', 'docker']],
  ['DOS', ['dos', 'bat', 'cmd']],
  ['dsconfig', ['dsconfig']],
  ['DTS (Device Tree)', ['dts']],
  ['Dust', ['dust', 'dst']],
  ['EBNF', ['ebnf']],
  ['Elixir', ['elixir']],
  ['Elm', ['elm']],
  ['Erlang', ['erlang', 'erl']],
  ['Excel', ['excel', 'xls', 'xlsx']],
  ['F#', ['fsharp', 'fs', 'fsx', 'fsi', 'fsscript']],
  ['FIX', ['fix']],
  ['Fortran', ['fortran', 'f90', 'f95']],
  ['G-Code', ['gcode', 'nc']],
  ['Gams', ['gams', 'gms']],
  ['GAUSS', ['gauss', 'gss']],
  ['Gherkin', ['gherkin']],
  ['Go', ['go', 'golang']],
  ['Golo', ['golo', 'gololang']],
  ['Gradle', ['gradle']],
  ['GraphQL', ['graphql', 'gql']],
  ['Groovy', ['groovy']],
  ['Haml', ['haml']],
  ['Handlebars', ['handlebars', 'hbs', 'html.hbs', 'html.handlebars']],
  ['Haskell', ['haskell', 'hs']],
  ['Haxe', ['haxe', 'hx']],
  ['HTML, XML', ['xml', 'html', 'xhtml', 'rss', 'atom', 'xjb', 'xsd', 'xsl', 'plist', 'svg']],
  ['HTTP', ['http', 'https']],
  ['Hy', ['hy', 'hylang']],
  ['Inform7', ['inform7', 'i7']],
  ['Ini, TOML', ['ini', 'toml']],
  ['Iptables', ['iptables']],
  ['IRPF90', ['irpf90']],
  ['Java', ['java', 'jsp']],
  ['JavaScript', ['javascript', 'js', 'jsx']],
  ['JSON', ['json', 'jsonc', 'json5']],
  ['Julia', ['julia', 'jl']],
  ['Julia REPL', ['julia-repl']],
  ['Kotlin', ['kotlin', 'kt']],
  ['Lasso', ['lasso', 'ls', 'lassoscript']],
  ['LaTeX', ['tex']],
  ['LDIF', ['ldif']],
  ['Leaf', ['leaf']],
  ['Less', ['less']],
  ['Lisp', ['lisp']],
  ['LiveCode Server', ['livecodeserver']],
  ['LiveScript', ['livescript', 'ls']],
  ['Lua', ['lua', 'pluto']],
  ['Makefile', ['makefile', 'mk', 'mak', 'make']],
  ['Markdown', ['markdown', 'md', 'mkdown', 'mkd']],
  ['Mathematica', ['mathematica', 'mma', 'wl']],
  ['Matlab', ['matlab']],
  ['Maxima', ['maxima']],
  ['Maya Embedded Language', ['mel']],
  ['Mercury', ['mercury']],
  ['MIPS Assembler', ['mips', 'mipsasm']],
  ['Mizar', ['mizar']],
  ['Mojolicious', ['mojolicious']],
  ['Monkey', ['monkey']],
  ['Moonscript', ['moonscript', 'moon']],
  ['N1QL', ['n1ql']],
  ['Nginx', ['nginx', 'nginxconf']],
  ['Nim', ['nim', 'nimrod']],
  ['Nix', ['nix']],
  ['NSIS', ['nsis']],
  ['Objective C', ['objectivec', 'mm', 'objc', 'obj-c', 'obj-c++', 'objective-c++']],
  ['OCaml', ['ocaml', 'ml']],
  ['OpenGL Shading Language', ['glsl']],
  ['OpenSCAD', ['openscad', 'scad']],
  ['Oracle Rules Language', ['ruleslanguage']],
  ['Oxygene', ['oxygene']],
  ['Parser3', ['parser3']],
  ['Perl', ['perl', 'pl', 'pm']],
  ['PF', ['pf', 'pf.conf']],
  ['PHP', ['php']],
  ['Plaintext', ['plaintext', 'txt', 'text']],
  ['Pony', ['pony']],
  ['PostgreSQL & PL/pgSQL', ['pgsql', 'postgres', 'postgresql']],
  ['PowerShell', ['powershell', 'ps', 'ps1']],
  ['Processing', ['processing']],
  ['Prolog', ['prolog']],
  ['Properties', ['properties']],
  ['Protocol Buffers', ['proto', 'protobuf']],
  ['Puppet', ['puppet', 'pp']],
  ['Python', ['python', 'py', 'gyp']],
  ['Python profiler results', ['profile']],
  ['Python REPL', ['python-repl', 'pycon']],
  ['Q', ['k', 'kdb']],
  ['QML', ['qml']],
  ['R', ['r']],
  ['ReasonML', ['reasonml', 're']],
  ['RenderMan RIB', ['rib']],
  ['RenderMan RSL', ['rsl']],
  ['Roboconf', ['graph', 'instances']],
  ['Ruby', ['ruby', 'rb', 'gemspec', 'podspec', 'thor', 'irb']],
  ['Rust', ['rust', 'rs']],
  ['SAS', ['SAS', 'sas']],
  ['Scala', ['scala']],
  ['Scheme', ['scheme']],
  ['Scilab', ['scilab', 'sci']],
  ['SCSS', ['scss']],
  ['Shell', ['shell', 'console']],
  ['Smali', ['smali']],
  ['Smalltalk', ['smalltalk', 'st']],
  ['SML', ['sml', 'ml']],
  ['SQL', ['sql']],
  ['Stan', ['stan', 'stanfuncs']],
  ['Stata', ['stata']],
  ['STEP Part 21', ['p21', 'step', 'stp']],
  ['Stylus', ['stylus', 'styl']],
  ['SubUnit', ['subunit']],
  ['Swift', ['swift']],
  ['Tcl', ['tcl', 'tk']],
  ['Terraform (HCL)', ['terraform', 'tf', 'hcl']],
  ['Test Anything Protocol', ['tap']],
  ['Thrift', ['thrift']],
  ['TP', ['tp']],
  ['Twig', ['twig', 'craftcms']],
  ['TypeScript', ['typescript', 'ts', 'tsx', 'mts', 'cts']],
  ['Vala', ['vala']],
  ['VB.Net', ['vbnet', 'vb']],
  ['VBA', ['vba']],
  ['VBScript', ['vbscript', 'vbs']],
  ['Verilog', ['verilog', 'v']],
  ['VHDL', ['vhdl']],
  ['Vim Script', ['vim']],
  ['X++', ['axapta', 'x++']],
  ['x86 Assembly', ['x86asm']],
  ['XL', ['xl', 'tao']],
  ['XQuery', ['xquery', 'xpath', 'xq', 'xqm']],
  ['YAML', ['yml', 'yaml']],
  ['Zephir', ['zephir', 'zep']],
];

const SUPPORTED_HLJS_ALIASES: Record<string, string> = {};
const HLJS_LANGUAGE_LABELS: Record<string, string> = {};
for (const [label, aliases] of SUPPORTED_HLJS_LANGUAGE_ROWS) {
  const primaryAlias = aliases[0];
  if (!primaryAlias) continue;
  for (const alias of aliases) {
    SUPPORTED_HLJS_ALIASES[alias] ||= primaryAlias;
    HLJS_LANGUAGE_LABELS[alias] ||= label;
  }
}

type HljsLanguageFactory = (hljs: any) => any;

function importedLanguage(value: unknown): unknown {
  return (value && typeof value === 'object' && 'default' in value)
    ? (value as { default: unknown }).default
    : value;
}

function languageDefiner(value: unknown): unknown {
  const language = importedLanguage(value);
  if ((typeof language === 'function' || (language && typeof language === 'object')) && 'definer' in Object(language)) {
    return (language as { definer?: unknown }).definer || language;
  }
  return language;
}

function registerLanguage(name: string, language: unknown): void {
  const factory = languageDefiner(language);
  if (typeof factory === 'function' && !hljs.getLanguage(name)) {
    hljs.registerLanguage(name, factory as HljsLanguageFactory);
  }
}

function bbcodeLanguage(hljsInstance: any): any {
  return {
    name: 'BBCode',
    aliases: ['bbcode'],
    case_insensitive: true,
    contains: [
      {
        className: 'name',
        begin: /\[[^=\s\]]*/,
      },
      {
        className: 'name',
        begin: ']',
      },
      {
        className: 'attribute',
        begin: /(?<==)[^\]\s]*/,
      },
      {
        className: 'attr',
        begin: /(?<=\[[^\]]* )[^\s=\]]*/,
      },
      {
        className: 'string',
        begin: /[=;:8]'?\-?[\)\(3SPDO>@$|/]/,
      },
      {
        className: 'string',
        begin: /:[\w]*:/,
      },
    ],
  };
}

registerLanguage('bbcode', bbcodeLanguage);
registerLanguage('curl', curlLanguage);
registerLanguage('iptables', iptablesLanguage);
registerLanguage('terraform', terraformLanguage);
registerLanguage('vba', vbaLanguage);

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="6" fill="#3b82f6"/>
<text x="16" y="22" text-anchor="middle" font-family="monospace" font-weight="700" font-size="16" fill="#fff">0x0</text>
</svg>`;

// ─── Utilities ───────────────────────────────────────────────────────────────

function getClientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') || '0.0.0.0';
}

function verifyPassword(password: string, storedPassword: string): boolean {
  return password === storedPassword;
}

function uploadTtlHours(env: Env): number {
  const raw = env.UPLOAD_TTL_HOURS;
  const parsed = raw === undefined || raw === '' ? DEFAULT_UPLOAD_TTL_HOURS : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_UPLOAD_TTL_HOURS;
}

function uploadExpiresAt(env: Env, uploadedAtMs = Date.now()): string {
  return new Date(uploadedAtMs + uploadTtlHours(env) * HOUR_MS).toISOString();
}

function metaKey(id: string): string {
  return `${META_KEY_PREFIX}${id}`;
}

function expiryIndexKey(id: string, expiresAtMs: number): string {
  return `${EXPIRY_INDEX_PREFIX}${String(Math.floor(expiresAtMs)).padStart(13, '0')}:${id}`;
}

function parseExpiryIndexKey(key: string): { id: string; expiresAtMs: number } | null {
  const match = key.match(/^expiry:(\d{13,}):([a-zA-Z0-9]+)$/);
  if (!match) return null;
  return { id: match[2], expiresAtMs: Number(match[1]) };
}

function metaExpiresAtMs(meta: FileMeta, env: Env): number {
  if (meta.expires) {
    const expiresAtMs = Date.parse(meta.expires);
    if (Number.isFinite(expiresAtMs)) return expiresAtMs;
  }

  const uploadedAtMs = Date.parse(meta.uploaded);
  if (Number.isFinite(uploadedAtMs)) {
    return uploadedAtMs + uploadTtlHours(env) * HOUR_MS;
  }

  return Date.now() + uploadTtlHours(env) * HOUR_MS;
}

function metaExpiryIndexKey(id: string, meta: FileMeta, env: Env): string {
  return expiryIndexKey(id, metaExpiresAtMs(meta, env));
}

async function getFileMeta(id: string, env: Env): Promise<FileMeta | null> {
  const metaStr = await env.KV.get(metaKey(id));
  if (!metaStr) return null;
  return JSON.parse(metaStr) as FileMeta;
}

async function putFileMeta(id: string, meta: FileMeta, env: Env): Promise<void> {
  const expiresAtMs = metaExpiresAtMs(meta, env);
  const expirationTtl = Math.max(60, Math.ceil((expiresAtMs - Date.now()) / 1000));
  await Promise.all([
    env.KV.put(metaKey(id), JSON.stringify(meta), { expirationTtl }),
    env.KV.put(expiryIndexKey(id, expiresAtMs), ''),
  ]);
}

async function ensureFileMetaExpiry(id: string, meta: FileMeta, env: Env): Promise<FileMeta> {
  if (meta.expires) return meta;
  const updated = { ...meta, expires: new Date(metaExpiresAtMs(meta, env)).toISOString() };
  await putFileMeta(id, updated, env);
  return updated;
}

async function deleteUpload(id: string, env: Env, meta?: FileMeta | null): Promise<void> {
  const writes: Array<Promise<void>> = [
    env.BUCKET.delete(id),
    env.KV.delete(metaKey(id)),
  ];

  if (meta) {
    writes.push(env.KV.delete(metaExpiryIndexKey(id, meta, env)));
  }

  await Promise.all(writes);
}

async function expireUploadIfNeeded(id: string, meta: FileMeta, env: Env, now = Date.now()): Promise<boolean> {
  if (metaExpiresAtMs(meta, env) > now) return false;
  await deleteUpload(id, env, meta);
  return true;
}

async function sweepExpiredUploads(env: Env, now = Date.now()): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;

  do {
    const list = await env.KV.list({
      prefix: EXPIRY_INDEX_PREFIX,
      cursor,
      limit: EXPIRY_INDEX_PAGE_SIZE,
    });

    const expiredKeys = list.keys
      .map(key => ({ keyName: key.name, parsed: parseExpiryIndexKey(key.name) }))
      .filter(item => !item.parsed || item.parsed.expiresAtMs <= now);

    await Promise.all(expiredKeys.map(async item => {
      if (!item.parsed) {
        await env.KV.delete(item.keyName);
        return;
      }

      const meta = await getFileMeta(item.parsed.id, env);
      if (meta) {
        const normalizedMeta = await ensureFileMetaExpiry(item.parsed.id, meta, env);
        if (await expireUploadIfNeeded(item.parsed.id, normalizedMeta, env, now)) {
          deleted++;
          return;
        }
        await Promise.all([
          env.KV.delete(item.keyName),
          env.KV.put(metaExpiryIndexKey(item.parsed.id, normalizedMeta, env), ''),
        ]);
        return;
      }

      await Promise.all([
        env.BUCKET.delete(item.parsed.id),
        env.KV.delete(item.keyName),
      ]);
      deleted++;
    }));

    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  return deleted;
}

async function backfillExpiryIndexes(env: Env, now = Date.now()): Promise<number> {
  if (await env.KV.get(EXPIRY_BACKFILL_DONE_KEY)) return 0;

  const cursor = await env.KV.get(EXPIRY_BACKFILL_CURSOR_KEY);
  const list = await env.KV.list({
    prefix: META_KEY_PREFIX,
    cursor: cursor || undefined,
    limit: EXPIRY_INDEX_PAGE_SIZE,
  });

  let touched = 0;
  await Promise.all(list.keys.map(async key => {
    const id = key.name.slice(META_KEY_PREFIX.length);
    const meta = await getFileMeta(id, env);
    if (!meta) return;

    const normalizedMeta = await ensureFileMetaExpiry(id, meta, env);
    if (await expireUploadIfNeeded(id, normalizedMeta, env, now)) {
      touched++;
      return;
    }

    await env.KV.put(metaExpiryIndexKey(id, normalizedMeta, env), '');
    touched++;
  }));

  if (list.list_complete) {
    await Promise.all([
      env.KV.delete(EXPIRY_BACKFILL_CURSOR_KEY),
      env.KV.put(EXPIRY_BACKFILL_DONE_KEY, '1'),
    ]);
  } else {
    await env.KV.put(EXPIRY_BACKFILL_CURSOR_KEY, list.cursor);
  }

  return touched;
}

async function runExpiryMaintenance(env: Env, now = Date.now()): Promise<void> {
  await backfillExpiryIndexes(env, now);
  await sweepExpiredUploads(env, now);
}

async function isIpAuthorized(ip: string, kv: KVNamespace): Promise<boolean> {
  const val = await kv.get(`ip:${ip}`);
  return val !== null;
}

async function authorizeIp(ip: string, kv: KVNamespace): Promise<void> {
  await kv.put(`ip:${ip}`, new Date().toISOString(), { expirationTtl: IP_TTL_SECONDS });
}

async function isIpBanned(ip: string, kv: KVNamespace): Promise<boolean> {
  const val = await kv.get(`ban:${ip}`);
  return val !== null;
}

async function recordFailedAttempt(ip: string, kv: KVNamespace): Promise<boolean> {
  const key = `authfail:${ip}`;
  const now = Date.now();
  const raw = await kv.get(key);
  let attempts: number[] = raw ? JSON.parse(raw) : [];
  // Keep only attempts within the window
  attempts = attempts.filter(t => now - t < AUTH_WINDOW_SECONDS * 1000);
  attempts.push(now);
  await kv.put(key, JSON.stringify(attempts), { expirationTtl: AUTH_WINDOW_SECONDS });
  if (attempts.length > AUTH_MAX_ATTEMPTS) {
    await kv.put(`ban:${ip}`, new Date().toISOString(), { expirationTtl: AUTH_BAN_SECONDS });
    await kv.delete(key);
    return true; // banned
  }
  return false;
}

async function clearFailedAttempts(ip: string, kv: KVNamespace): Promise<void> {
  await kv.delete(`authfail:${ip}`);
}

function getExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function isTextType(type: string, ext: string): boolean {
  if (type.startsWith('text/')) return true;
  if (type.includes('json') || type.includes('xml') || type.includes('javascript')
    || type.includes('yaml') || type.includes('svg')) return true;
  return !!SUPPORTED_HLJS_ALIASES[ext] || !!EXTENSION_LANGUAGE_OVERRIDES[ext];
}

// Map file extension to highlight.js language identifier
function extToHljsLang(ext: string): string {
  return EXTENSION_LANGUAGE_OVERRIDES[ext] || SUPPORTED_HLJS_ALIASES[ext] || 'plaintext';
}

const EXTENSION_LANGUAGE_OVERRIDES: Record<string, string> = {
  htm: 'xml',
  mjs: 'javascript',
  cjs: 'javascript',
  sass: 'scss',
  vue: 'xml',
  svelte: 'xml',
  astro: 'xml',
  cfg: 'ini',
  conf: 'ini',
  env: 'bash',
  fish: 'bash',
  ex: 'elixir',
  exs: 'elixir',
  hrl: 'erlang',
  mli: 'ocaml',
  cljs: 'clojure',
  edn: 'clojure',
  sv: 'verilog',
  rake: 'ruby',
  mod: 'go',
  sum: 'go',
  sbt: 'scala',
  cabal: 'haskell',
  lock: 'json',
  gitignore: 'plaintext',
  editorconfig: 'ini',
  rst: 'plaintext',
  log: 'plaintext',
  csv: 'plaintext',
  tsv: 'plaintext',
};

const LANGUAGE_CHIP_COLORS = [
  'blue',
  'cyan',
  'emerald',
  'amber',
  'rose',
  'violet',
  'teal',
  'indigo',
  'fuchsia',
  'slate',
];

function languageChipClass(lang: string): string {
  const key = (lang || 'plaintext').toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `language-chip-${LANGUAGE_CHIP_COLORS[hash % LANGUAGE_CHIP_COLORS.length]}`;
}

function fallbackLanguageLabel(lang: string): string {
  return HLJS_LANGUAGE_LABELS[lang] || lang || 'text';
}

function normalizeLanguageLabel(label: string): string {
  return label
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*&\s*/g, ', ')
    .replace(/\s+also\s+/gi, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*)+/g, ', ')
    .replace(/^,\s*|\s*,\s*$/g, '');
}

function displayLanguageLabel(lang: string): string {
  const fallback = normalizeLanguageLabel(fallbackLanguageLabel(lang));
  const registeredName = hljs.getLanguage(lang)?.name;
  if (!registeredName || registeredName.toLowerCase() === lang.toLowerCase()) {
    return fallback;
  }
  return normalizeLanguageLabel(registeredName);
}

function isImageType(type: string): boolean {
  return type.startsWith('image/');
}

function detectExtFromContent(text: string): string {
  const head = text.trimStart().slice(0, 2000);

  // JSON
  if (/^\s*[[{]/.test(head) && /[":]/.test(head)) {
    try { JSON.parse(text.trim().slice(0, 50000)); return 'json'; } catch {}
  }
  // XML
  if (/^\s*<\?xml/i.test(head)) return 'xml';
  // HTML
  if (/^\s*<!doctype\s+html/i.test(head) || /^\s*<html[\s>]/i.test(head)) return 'html';
  // YAML
  if (/^---\s*$/m.test(head.slice(0, 200))) return 'yaml';
  // Shebang
  const shebang = head.match(/^#!\s*\/\S+/);
  if (shebang) {
    const s = shebang[0];
    if (/\b(ba)?sh\b|\/zsh\b/.test(s)) return 'sh';
    if (/python/.test(s)) return 'py';
    if (/node\b/.test(s)) return 'js';
    if (/ruby\b/.test(s)) return 'rb';
    if (/perl\b/.test(s)) return 'pl';
  }
  // SQL
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/i.test(head)) return 'sql';
  // CSS
  if (/^\s*[.#@][a-zA-Z][\w-]*\s*\{/.test(head)) return 'css';
  // Dockerfile
  if (/^\s*FROM\s+\S+/i.test(head) && /\b(RUN|CMD|COPY|EXPOSE)\b/i.test(head)) return 'dockerfile';

  return 'log';
}

interface PreviewLanguage {
  lang: string;
  autoDetectLang: boolean;
}

interface HighlightedPreview {
  lineHtml: string[];
  lang: string;
  text: string;
}

function shouldAutoDetectPreviewLanguage(meta: FileMeta): boolean {
  const type = meta.type.toLowerCase();
  return meta.ext === ''
    || meta.ext === 'txt'
    || meta.ext === 'log'
    || type === 'text/plain'
    || type === 'application/octet-stream';
}

function resolvePreviewLanguage(meta: FileMeta, content: string): PreviewLanguage {
  const lang = extToHljsLang(meta.ext);
  if (!content || lang !== 'plaintext' || !shouldAutoDetectPreviewLanguage(meta)) {
    return { lang, autoDetectLang: false };
  }

  const detectedExt = detectExtFromContent(content);
  const detectedLang = extToHljsLang(detectedExt);
  if (detectedLang !== 'plaintext') {
    return { lang: detectedLang, autoDetectLang: false };
  }

  return { lang, autoDetectLang: true };
}

function normalizePreviewText(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

function splitPreviewLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.length > 0 ? lines : [''];
}

function closeTagForOpenTag(tag: string): string {
  const match = tag.match(/^<([a-z0-9-]+)/i);
  return match ? `</${match[1].toLowerCase()}>` : '';
}

function splitHighlightedHtml(html: string, originalText: string): string[] {
  const lines = [''];
  const openTags: string[] = [];
  const tagRegex = /<\/?span(?:\s+[^>]*)?>/gi;
  let lastIndex = 0;

  function append(value: string): void {
    lines[lines.length - 1] += value;
  }

  function startNewLine(): void {
    for (let i = openTags.length - 1; i >= 0; i--) {
      append(closeTagForOpenTag(openTags[i]));
    }
    lines.push('');
    for (const tag of openTags) {
      append(tag);
    }
  }

  function appendText(value: string): void {
    const parts = value.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) startNewLine();
      append(part);
    });
  }

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(html)) !== null) {
    appendText(html.slice(lastIndex, match.index));

    const tag = match[0];
    append(tag);
    if (tag.startsWith('</')) {
      openTags.pop();
    } else {
      openTags.push(tag);
    }

    lastIndex = tagRegex.lastIndex;
  }

  appendText(html.slice(lastIndex));

  if (originalText.endsWith('\n') && lines.length > 1) {
    lines.pop();
  }

  return lines.length > 0 ? lines : [''];
}

function renderHighlightedPreview(content: string, previewLanguage: PreviewLanguage): HighlightedPreview {
  const text = normalizePreviewText(content);
  let lang = previewLanguage.lang;
  let lineHtml: string[] | null = null;

  if (text && previewLanguage.autoDetectLang) {
    const result = hljs.highlightAuto(text);
    if (result.language && hljs.getLanguage(result.language)) {
      lang = result.language;
      lineHtml = splitHighlightedHtml(result.value, text);
    }
  } else if (text && lang !== 'plaintext' && hljs.getLanguage(lang)) {
    try {
      const result = hljs.highlight(text, { language: lang, ignoreIllegals: true });
      lineHtml = splitHighlightedHtml(result.value, text);
    } catch {
      lineHtml = null;
    }
  }

  return {
    lineHtml: lineHtml || splitPreviewLines(text).map(escapeHtml),
    lang,
    text,
  };
}

function renderCodeLines(lineHtml: string[]): string {
  return lineHtml.map((html, index) => {
    const lineNumber = index + 1;
    return `<div class="code-line" data-line="${lineNumber}"><span class="line-number" aria-hidden="true">${lineNumber}</span><code class="code-line-content">${html || '&#8203;'}</code></div>`;
  }).join('');
}

function scriptJson(value: unknown): string {
  const json = JSON.stringify(value) ?? 'null';
  return json
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function browserDateScript(): string {
  return String.raw`(() => {
  function formatRemainingDuration(expiresAtMs) {
    const remainingMs = expiresAtMs - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) return '0 minutes';

    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;
    if (remainingMs < hourMs) {
      const minutes = Math.ceil(remainingMs / minuteMs);
      return minutes + ' ' + (minutes === 1 ? 'minute' : 'minutes');
    }

    if (remainingMs < dayMs) {
      const hours = Math.ceil(remainingMs / hourMs);
      return hours + ' ' + (hours === 1 ? 'hour' : 'hours');
    }

    const days = Math.ceil(remainingMs / dayMs);
    return days + ' ' + (days === 1 ? 'day' : 'days');
  }

  function formatToolbarDate() {
    const dateEl = document.querySelector('.toolbar-date');
    const expiryEl = document.querySelector('.toolbar-expiry');

    if (dateEl) {
      const iso = dateEl.dataset.iso;
      const size = dateEl.dataset.size || '';
      if (iso) {
        const date = new Date(iso);
        if (!Number.isNaN(date.getTime())) {
          const formatted = new Intl.DateTimeFormat(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(date);
          dateEl.textContent = size ? formatted + ' · ' + size : formatted;
        }
      }
    }

    if (expiryEl) {
      const expires = expiryEl.dataset.expires;
      const expiresAtMs = expires ? Date.parse(expires) : NaN;
      if (!Number.isNaN(expiresAtMs)) {
        expiryEl.textContent = 'Deletes in ' + formatRemainingDuration(expiresAtMs);
      }
    }
  }

  function startToolbarClock() {
    formatToolbarDate();
    window.setInterval(formatToolbarDate, 60 * 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startToolbarClock, { once: true });
  } else {
    startToolbarClock();
  }
})();`;
}

function textViewerScript(): string {
  return String.raw`document.addEventListener('DOMContentLoaded', () => {
  const data = window.__VIEWER_DATA__ || {};
  const codeLines = document.getElementById('codeLines');
  const codeContainer = document.getElementById('codeContainer');
  const codeWrapper = document.getElementById('codeWrapper');
  const searchInput = document.getElementById('search');
  const searchCount = document.getElementById('searchCount');
  const prevBtn = document.getElementById('prevMatch');
  const nextBtn = document.getElementById('nextMatch');
  const clearBtn = document.getElementById('searchClear');
  const wrapBtn = document.getElementById('wrapBtn');
  const formatBtn = document.getElementById('formatBtn');

  if (!codeLines || !codeContainer || !codeWrapper || !searchInput || !searchCount || !prevBtn || !nextBtn || !clearBtn || !wrapBtn || !formatBtn) {
    return;
  }

  const originalText = typeof data.originalText === 'string' ? data.originalText : '';
  const originalLineHtml = Array.from(codeLines.querySelectorAll('.code-line-content')).map(line => line.innerHTML);
  const originalLang = codeLines.dataset.lang || 'plaintext';
  const languageLabels = data.languageLabels && typeof data.languageLabels === 'object' ? data.languageLabels : {};
  const languageChipClasses = data.languageChipClasses && typeof data.languageChipClasses === 'object' ? data.languageChipClasses : {};
  let currentText = originalText;
  let formatted = false;
  let selectAllCodeActive = false;

  function normalizeLineEndings(text) {
    return text.replace(/\r\n?/g, '\n');
  }

  function splitLines(text) {
    const lines = text.split('\n');
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    return lines.length > 0 ? lines : [''];
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setLanguageBadge(lang) {
    const badge = document.getElementById('languageBadge');
    const badgeText = document.getElementById('languageBadgeText');
    if (!badge || !badgeText) return;
    const normalizedLang = lang || 'plaintext';
    badgeText.textContent = languageLabels[normalizedLang] || normalizedLang || 'text';
    badge.className = 'language-chip ' + (languageChipClasses[normalizedLang] || languageChipClasses.plaintext || 'language-chip-slate');
  }

  function setLineNumberWidth(lineCount) {
    const width = Math.max(4, String(Math.max(1, lineCount)).length + 3);
    codeWrapper.style.setProperty('--line-number-width', width + 'ch');
  }

  function renderRows(lineHtml, lang) {
    const safeLines = lineHtml.length > 0 ? lineHtml : [''];
    codeLines.innerHTML = safeLines.map((html, index) => {
      const lineNumber = index + 1;
      return '<div class="code-line" data-line="' + lineNumber + '">'
        + '<span class="line-number" aria-hidden="true">' + lineNumber + '</span>'
        + '<code class="code-line-content">' + (html || '&#8203;') + '</code>'
        + '</div>';
    }).join('');
    codeLines.className = 'code-lines hljs language-' + (lang || 'plaintext');
    codeLines.dataset.lang = lang || 'plaintext';
    setLanguageBadge(lang || 'plaintext');
    setLineNumberWidth(safeLines.length);
    linkifyUrls();
    rebuildSearchIndex();
  }

  function renderPlainText(text) {
    currentText = normalizeLineEndings(text);
    renderRows(splitLines(currentText).map(escapeHtml), 'plaintext');
  }

  function restoreOriginalText() {
    currentText = originalText;
    renderRows(originalLineHtml, originalLang);
  }

  function linkifyUrls() {
    const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
    const walker = document.createTreeWalker(codeLines, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement && node.parentElement.closest('a')) {
          return NodeFilter.FILTER_REJECT;
        }
        if (node.parentElement && node.parentElement.classList.contains('line-number')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    for (const node of textNodes) {
      const text = node.textContent || '';
      urlRegex.lastIndex = 0;
      if (!urlRegex.test(text)) continue;
      urlRegex.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match;
      while ((match = urlRegex.exec(text)) !== null) {
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
        }
        const a = document.createElement('a');
        a.href = match[0];
        a.className = 'code-link';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = match[0];
        frag.appendChild(a);
        lastIdx = urlRegex.lastIndex;
      }
      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      }
      if (node.parentNode) {
        node.parentNode.replaceChild(frag, node);
      }
    }
  }

  function formatStructuredText(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;

    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {}

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'text/xml');
      if (doc.querySelector('parsererror')) return null;
      const serializer = new XMLSerializer();
      const raw = serializer.serializeToString(doc.documentElement);
      let indent = 0;
      return raw.replace(/(>)(<)/g, '$1\n$2').split('\n').map(part => {
        if (part.match(/^<\//)) indent--;
        const pad = '  '.repeat(Math.max(0, indent));
        if (part.match(/^<[^/]/) && !part.match(/\/>$/) && !part.match(/<\/.*>$/)) indent++;
        return pad + part;
      }).join('\n');
    } catch {
      return null;
    }
  }

  function formatLogText(text) {
    return text.split('\n').map(line => tryFormatJSON(line) || tryFormatXML(line) || tryFormatKV(line) || line).join('\n');
  }

  function tryFormatJSON(line) {
    const jsonStart = line.search(/[{\[]/);
    if (jsonStart === -1) return null;
    for (let i = jsonStart; i < line.length; i++) {
      if (line[i] !== '{' && line[i] !== '[') continue;
      const candidate = line.slice(i);
      try {
        const parsed = JSON.parse(candidate);
        return line.slice(0, i) + JSON.stringify(parsed, null, 2);
      } catch {}
    }
    return null;
  }

  function tryFormatXML(line) {
    const xmlStart = line.search(/<[a-zA-Z][^>]*>/);
    if (xmlStart === -1) return null;
    const candidate = line.slice(xmlStart).trim();
    if (!/<\/[a-zA-Z]/.test(candidate) && !/\/>/.test(candidate)) return null;
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(candidate, 'text/xml');
      if (doc.querySelector('parsererror')) return null;
      const serializer = new XMLSerializer();
      const raw = serializer.serializeToString(doc.documentElement);
      let indent = 0;
      const pretty = raw.replace(/(>)(<)/g, '$1\n$2').split('\n').map(part => {
        if (part.match(/^<\//)) indent--;
        const pad = '  '.repeat(Math.max(0, indent));
        if (part.match(/^<[^/]/) && !part.match(/\/>$/) && !part.match(/<\/.*>$/)) indent++;
        return pad + part;
      }).join('\n');
      return line.slice(0, xmlStart) + pretty;
    } catch {
      return null;
    }
  }

  function tryFormatKV(line) {
    const kvRegex = /([a-zA-Z_][a-zA-Z0-9_.-]*)=("[^"]*"|'[^']*'|[^\s,]+)/g;
    const pairs = [];
    let match;
    while ((match = kvRegex.exec(line)) !== null) {
      pairs.push({ key: match[1], value: match[2], index: match.index });
    }
    if (pairs.length < 3) return null;
    const prefix = line.slice(0, pairs[0].index).trimEnd();
    const formattedPairs = pairs.map(pair => '  ' + pair.key + ' = ' + pair.value).join('\n');
    return prefix ? prefix + '\n' + formattedPairs : formattedPairs;
  }

  formatBtn.addEventListener('click', () => {
    formatted = !formatted;
    formatBtn.classList.toggle('active', formatted);
    if (formatted) {
      renderPlainText(formatStructuredText(originalText) || formatLogText(originalText));
    } else {
      restoreOriginalText();
    }
  });

  wrapBtn.addEventListener('click', () => {
    const wrapped = codeWrapper.classList.toggle('wrap');
    wrapBtn.classList.toggle('active', wrapped);
  });

  let fontSizePx = parseFloat(getComputedStyle(codeLines).fontSize) || 13;
  function applyFontSize() {
    codeWrapper.style.setProperty('--viewer-code-font-size', fontSizePx + 'px');
  }

  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (event.key === '=' || event.key === '+') {
      event.preventDefault();
      fontSizePx = Math.min(fontSizePx + 1, 32);
      applyFontSize();
    } else if (event.key === '-') {
      event.preventDefault();
      fontSizePx = Math.max(fontSizePx - 1, 8);
      applyFontSize();
    } else if (event.key === '0') {
      event.preventDefault();
      fontSizePx = 13;
      applyFontSize();
    }
  });

  codeWrapper.addEventListener('wheel', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    fontSizePx = event.deltaY < 0 ? Math.min(fontSizePx + 1, 32) : Math.max(fontSizePx - 1, 8);
    applyFontSize();
  }, { passive: false });

  function selectAllCode() {
    const lineContents = codeLines.querySelectorAll('.code-line-content');
    if (lineContents.length === 0) return;
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    const first = lineContents[0];
    const last = lineContents[lineContents.length - 1];
    range.setStart(first, 0);
    range.setEnd(last, last.childNodes.length);
    selection.removeAllRanges();
    selection.addRange(range);
    selectAllCodeActive = true;
  }

  function nodeInsideCode(node) {
    return !!node && codeLines.contains(node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode);
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      if (document.activeElement === searchInput) return;
      event.preventDefault();
      selectAllCode();
    }
  });

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      selectAllCodeActive = false;
      return;
    }
    selectAllCodeActive = selectAllCodeActive && nodeInsideCode(selection.anchorNode) && nodeInsideCode(selection.focusNode);
  });

  document.addEventListener('copy', (event) => {
    if (!selectAllCodeActive || !event.clipboardData) return;
    event.clipboardData.setData('text/plain', currentText);
    event.preventDefault();
  });

  codeLines.addEventListener('mousedown', () => {
    selectAllCodeActive = false;
  });

  const supportsHighlights = typeof window.Highlight !== 'undefined' && typeof CSS !== 'undefined' && !!CSS.highlights;
  const hlResults = supportsHighlights ? new Highlight() : null;
  const hlActive = supportsHighlights ? new Highlight() : null;
  if (supportsHighlights) {
    CSS.highlights.set('search-results', hlResults);
    CSS.highlights.set('search-active', hlActive);
  }

  let textNodes = [];
  let nodeOffsets = [];
  let plainText = '';
  let matchRanges = [];
  let currentIndex = -1;
  let debounce;

  function rebuildSearchIndex() {
    textNodes = [];
    nodeOffsets = [];
    plainText = '';

    const walker = document.createTreeWalker(codeLines, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement && node.parentElement.classList.contains('line-number')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    while (walker.nextNode()) {
      const value = (walker.currentNode.textContent || '').replace(/\u200B/g, '');
      if (!value) continue;
      textNodes.push(walker.currentNode);
      nodeOffsets.push(plainText.length);
      plainText += value;
    }

    if (searchInput.value) {
      doSearch(searchInput.value);
    } else {
      clearSearch();
    }
  }

  function clearSearch() {
    if (supportsHighlights) {
      hlResults.clear();
      hlActive.clear();
    }
    matchRanges = [];
    currentIndex = -1;
    searchCount.textContent = '';
  }

  function escapeRegExp(value) {
    return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }

  function findNodeAt(offset) {
    let lo = 0;
    let hi = textNodes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (nodeOffsets[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function createRangeForMatch(start, end) {
    if (textNodes.length === 0) return null;
    const startIndex = findNodeAt(start);
    const endIndex = findNodeAt(end - 1);
    const range = document.createRange();
    range.setStart(textNodes[startIndex], start - nodeOffsets[startIndex]);
    range.setEnd(textNodes[endIndex], end - nodeOffsets[endIndex]);
    return range;
  }

  function doSearch(query) {
    clearSearch();
    if (!query) return;

    const regex = new RegExp(escapeRegExp(query), 'gi');
    let match;
    while ((match = regex.exec(plainText)) !== null) {
      const range = createRangeForMatch(match.index, match.index + match[0].length);
      if (!range) continue;
      matchRanges.push(range);
      if (supportsHighlights) hlResults.add(range);
    }

    if (matchRanges.length === 0) {
      searchCount.textContent = '0 results';
      return;
    }

    currentIndex = 0;
    activateMatch(currentIndex);
  }

  function activateMatch(index) {
    if (!matchRanges[index]) return;
    if (supportsHighlights) {
      hlActive.clear();
      hlActive.add(matchRanges[index]);
    } else {
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(matchRanges[index]);
      }
    }

    const rect = matchRanges[index].getBoundingClientRect();
    const containerRect = codeContainer.getBoundingClientRect();
    if (rect.top < containerRect.top || rect.bottom > containerRect.bottom || rect.left < containerRect.left || rect.right > containerRect.right) {
      const parent = matchRanges[index].startContainer.parentElement;
      const line = parent ? parent.closest('.code-line') : null;
      if (line) line.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    }
    searchCount.textContent = (index + 1) + ' of ' + matchRanges.length;
  }

  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => doSearch(searchInput.value), 120);
  });

  clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearch();
    searchInput.focus();
  });

  nextBtn.addEventListener('click', () => {
    if (matchRanges.length === 0) return;
    currentIndex = (currentIndex + 1) % matchRanges.length;
    activateMatch(currentIndex);
  });

  prevBtn.addEventListener('click', () => {
    if (matchRanges.length === 0) return;
    currentIndex = (currentIndex - 1 + matchRanges.length) % matchRanges.length;
    activateMatch(currentIndex);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) prevBtn.click();
      else nextBtn.click();
    } else if (event.key === 'Escape') {
      searchInput.value = '';
      clearSearch();
      searchInput.blur();
    }
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  linkifyUrls();
  rebuildSearchIndex();
});`;
}

// ─── Request router ──────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      // POST /auth — authorize IP
      if (method === 'POST' && path === '/auth') {
        return handleAuth(request, env);
      }

      // POST / — upload file
      if (method === 'POST' && path === '/') {
        return handleUpload(request, env);
      }

      // GET /favicon.ico or /favicon.svg
      if (method === 'GET' && (path === '/favicon.ico' || path === '/favicon.svg')) {
        return new Response(FAVICON_SVG, {
          headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=604800',
          },
        });
      }

      // GET / — landing page
      if (method === 'GET' && path === '/') {
        return new Response(landingPageHtml(url.origin, uploadTtlHours(env)), {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // GET /:id/raw — raw file
      const rawMatch = path.match(/^\/([a-zA-Z0-9]+)\/raw$/);
      if (method === 'GET' && rawMatch) {
        return handleRaw(rawMatch[1], env, false);
      }

      // GET /:id/dl — force download
      const dlMatch = path.match(/^\/([a-zA-Z0-9]+)\/dl$/);
      if (method === 'GET' && dlMatch) {
        return handleRaw(dlMatch[1], env, true);
      }

      // DELETE /:id — delete file (requires auth)
      const delMatch = path.match(/^\/([a-zA-Z0-9]+)$/);
      if (method === 'DELETE' && delMatch) {
        return handleDelete(delMatch[1], request, env);
      }

      // GET /:id — viewer UI (browser) or raw (curl)
      const viewMatch = path.match(/^\/([a-zA-Z0-9]+)$/);
      if (method === 'GET' && viewMatch) {
        const ua = request.headers.get('user-agent') || '';
        const isCurl = /^curl\//i.test(ua);
        if (isCurl) {
          return handleRaw(viewMatch[1], env, false);
        }
        return handleView(viewMatch[1], env, url.origin);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err: any) {
      return new Response(`Error: ${err.message}`, { status: 500 });
    }
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runExpiryMaintenance(env, controller.scheduledTime));
  },
};

// ─── Handlers ────────────────────────────────────────────────────────────────

async function handleAuth(request: Request, env: Env): Promise<Response> {
  const ip = getClientIp(request);

  if (await isIpBanned(ip, env.KV)) {
    return new Response('Too many failed attempts. Try again later.\n', { status: 429 });
  }

  let password = '';

  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    const body = await request.json() as any;
    password = body.p || body.password || '';
  } else {
    const form = await request.formData();
    password = (form.get('p') || form.get('password') || '') as string;
  }

  if (!password) {
    return new Response('Missing password.\nUsage: curl -d "p=PASSWORD" <url>/auth\n', { status: 400 });
  }

  const valid = verifyPassword(password, env.PASSWORD);
  if (!valid) {
    const banned = await recordFailedAttempt(ip, env.KV);
    if (banned) {
      return new Response('Too many failed attempts. Try again later.\n', { status: 429 });
    }
    return new Response('Invalid password.\n', { status: 403 });
  }

  await clearFailedAttempts(ip, env.KV);
  await authorizeIp(ip, env.KV);
  return new Response(`IP ${ip} authorized. You can now upload files.\n`, { status: 200 });
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
  const ip = getClientIp(request);

  if (!(await isIpAuthorized(ip, env.KV))) {
    return new Response(
      'Unknown IP. Authorize first:\n  curl -d "p=PASSWORD" <url>/auth\n',
      { status: 401 }
    );
  }

  const ct = request.headers.get('content-type') || '';
  let fileData: ArrayBuffer;
  let fileName = 'paste.txt';
  let fileType = 'application/octet-stream';
  let command = request.headers.get('x-command') || '';

  if (ct.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) {
      return new Response('No file field in form data.\nUsage: curl -F "file=@yourfile" <url>\n', { status: 400 });
    }
    // cmd form field takes priority over x-command header
    const cmdField = (form.get('cmd') || '') as string;
    if (cmdField) command = cmdField;

    fileName = file.name || 'upload';
    fileType = file.type || 'application/octet-stream';
    fileData = await file.arrayBuffer();

    // Detect stdin pipe (curl -F 'file=@-')
    if (fileName === '-') {
      const sample = new TextDecoder().decode(fileData.slice(0, 4096));
      const detectedExt = detectExtFromContent(sample);
      fileName = `output.${detectedExt}`;
      fileType = 'text/plain';
    }
  } else {
    // Raw body upload (e.g., piped stdin)
    fileData = await request.arrayBuffer();
    fileName = request.headers.get('x-filename') || 'paste.txt';
    fileType = ct || 'text/plain';

    // Auto-detect extension for piped command output
    if (!request.headers.get('x-filename') && command) {
      const sample = new TextDecoder().decode(fileData.slice(0, 4096));
      const detectedExt = detectExtFromContent(sample);
      fileName = `output.${detectedExt}`;
    }
  }

  if (fileData.byteLength > MAX_FILE_SIZE) {
    return new Response(`File too large. Max ${MAX_FILE_SIZE / 1024 / 1024} MB.\n`, { status: 413 });
  }

  if (fileData.byteLength === 0) {
    return new Response('Empty file.\n', { status: 400 });
  }

  const id = await generateId(env.KV);
  const ext = getExtension(fileName);
  const uploaded = new Date();
  const expires = uploadExpiresAt(env, uploaded.getTime());

  // Store in R2
  await env.BUCKET.put(id, fileData, {
    customMetadata: { name: fileName, type: fileType, expires },
  });

  // Store metadata in KV
  const meta: FileMeta = {
    name: fileName,
    type: fileType,
    size: fileData.byteLength,
    uploaded: uploaded.toISOString(),
    expires,
    ext,
    ...(command && { command }),
  };
  await putFileMeta(id, meta, env);

  const url = new URL(request.url);
  return new Response(`${url.origin}/${id}\n`, { status: 200 });
}

async function handleRaw(id: string, env: Env, forceDownload: boolean): Promise<Response> {
  let meta = await getFileMeta(id, env);
  if (!meta) {
    await env.BUCKET.delete(id);
    return new Response('Not found.\n', { status: 404 });
  }

  meta = await ensureFileMetaExpiry(id, meta, env);
  if (await expireUploadIfNeeded(id, meta, env)) {
    return new Response('Not found.\n', { status: 404 });
  }

  const obj = await env.BUCKET.get(id);
  if (!obj) {
    await deleteUpload(id, env, meta);
    return new Response('Not found.\n', { status: 404 });
  }

  const headers: Record<string, string> = {
    'Content-Type': meta.type,
  };

  if (forceDownload) {
    headers['Content-Disposition'] = `attachment; filename="${meta.name}"`;
  }

  return new Response(obj.body, { headers });
}

async function handleDelete(id: string, request: Request, env: Env): Promise<Response> {
  const ip = getClientIp(request);
  if (!(await isIpAuthorized(ip, env.KV))) {
    return new Response('Unauthorized.\n', { status: 401 });
  }

  const obj = await env.BUCKET.get(id);
  if (!obj) return new Response('Not found.\n', { status: 404 });

  const meta = await getFileMeta(id, env);
  await deleteUpload(id, env, meta);
  return new Response('Deleted.\n', { status: 200 });
}

async function handleView(id: string, env: Env, origin: string): Promise<Response> {
  let meta = await getFileMeta(id, env);
  if (!meta) {
    await env.BUCKET.delete(id);
    return new Response('Not found.', { status: 404 });
  }

  meta = await ensureFileMetaExpiry(id, meta, env);
  if (await expireUploadIfNeeded(id, meta, env)) {
    return new Response('Not found.', { status: 404 });
  }

  const obj = await env.BUCKET.get(id);
  if (!obj) {
    await deleteUpload(id, env, meta);
    return new Response('Not found.', { status: 404 });
  }

  const isText = isTextType(meta.type, meta.ext);
  const isImage = isImageType(meta.type);

  let content = '';
  let truncated = false;

  if (isText) {
    const bytes = await obj.arrayBuffer();
    if (bytes.byteLength > MAX_PREVIEW_SIZE) {
      content = new TextDecoder().decode(bytes.slice(0, MAX_PREVIEW_SIZE));
      truncated = true;
    } else {
      content = new TextDecoder().decode(bytes);
    }
  }

  const previewLanguage = resolvePreviewLanguage(meta, content);
  const html = viewerPageHtml({
    id,
    origin,
    meta,
    content,
    lang: previewLanguage.lang,
    isText,
    isImage,
    truncated,
    autoDetectLang: previewLanguage.autoDetectLang,
  });

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// ─── HTML Templates ──────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatHoursDuration(hours: number): string {
  if (Number.isInteger(hours) && hours % 24 === 0) {
    const days = hours / 24;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

function formatRemainingDuration(expires: string | undefined, now = Date.now()): string {
  if (!expires) return '';
  const expiresAtMs = Date.parse(expires);
  if (!Number.isFinite(expiresAtMs)) return '';

  const remainingMs = expiresAtMs - now;
  if (remainingMs <= 0) return '0 minutes';

  if (remainingMs < HOUR_MS) {
    const minutes = Math.ceil(remainingMs / (60 * 1000));
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  }

  const dayMs = 24 * HOUR_MS;
  if (remainingMs < dayMs) {
    const hours = Math.ceil(remainingMs / HOUR_MS);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  const days = Math.ceil(remainingMs / dayMs);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

function landingPageHtml(origin: string, ttlHours: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>0x0.gg</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #09090b; --bg-card: #18181b; --bg-hover: #27272a;
    --border: #27272a; --border-light: #3f3f46;
    --text: #fafafa; --text-muted: #a1a1aa; --text-dim: #71717a;
    --accent: #3b82f6; --accent-hover: #2563eb;
    --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
    --font-mono: monospace;
    --radius: 8px;
  }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--font-sans); line-height: 1.6;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 2rem;
  }
  .container { max-width: 640px; width: 100%; }
  .logo {
    font-family: var(--font-mono); font-size: 1.5rem; font-weight: 600;
    color: var(--text); margin-bottom: 0.25rem;
  }
  .logo span { color: var(--accent); }
  .subtitle { color: var(--text-dim); font-size: 0.875rem; margin-bottom: 2rem; }
  .card {
    background: var(--bg-card); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 1.5rem; margin-bottom: 1rem;
  }
  .card-title {
    font-family: var(--font-mono); font-size: 0.75rem; font-weight: 500;
    color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.1em;
    margin-bottom: 1rem;
  }
  pre {
    font-family: var(--font-mono); font-size: 0.8125rem; line-height: 1.8;
    color: var(--text-muted); overflow-x: auto;
  }
  pre .cmd { color: var(--text); }
  pre .comment { color: var(--text-dim); }
  pre .url { color: var(--accent); }
  .divider {
    border: none; border-top: 1px solid var(--border);
    margin: 1.5rem 0;
  }
  .footer { color: var(--text-dim); font-size: 0.75rem; font-family: var(--font-mono); }
</style>
</head>
<body>
<div class="container">
  <div class="logo"><span>0x0</span>.gg</div>
  <div class="subtitle">Authenticated file hosting. Authorize your IP, then upload.</div>

  <div id="copyScope">

  <div class="card">
    <div class="card-title">1. Authorize</div>
    <pre><span class="cmd">curl</span> -d <span class="cmd">"p=PASSWORD"</span> <span class="url">${origin}/auth</span></pre>
  </div>

  <div class="card">
    <div class="card-title">2. Upload a file</div>
    <pre><span class="cmd">curl</span> -F <span class="cmd">"file=@image.png"</span> <span class="url">${origin}/</span></pre>
  </div>

  <div class="card">
    <div class="card-title">3. Pipe from stdin</div>
    <pre><span class="cmd">cat file.txt | curl</span> -H <span class="cmd">"x-filename: file.txt"</span> \\
     --data-binary @- <span class="url">${origin}/</span></pre>
  </div>

  <div class="card">
    <div class="card-title">4. Pipe command output or files</div>
    <pre><span class="comment"># add this to your .bashrc / .zshrc:</span>
<span class="cmd">0x0()</span> {
  if [ <span class="cmd">"$#"</span> -eq 1 ] && [ -f <span class="cmd">"$1"</span> ]; then
    curl -F <span class="cmd">"file=@$1"</span> <span class="url">${origin}/</span>
  else
    <span class="cmd">"$@"</span> | curl -F <span class="cmd">file=@-</span> -F <span class="cmd">"cmd=$*"</span> <span class="url">${origin}/</span>
  fi
}

<span class="comment"># then just:</span>
<span class="cmd">0x0</span> ./wrangler.toml
<span class="cmd">0x0</span> docker compose logs -n 50
<span class="cmd">0x0</span> kubectl get pods
<span class="cmd">0x0</span> cat /etc/nginx/nginx.conf</pre>
  </div>

  <div class="card">
    <div class="card-title">5. Delete a file</div>
    <pre><span class="cmd">curl</span> -X DELETE <span class="url">${origin}/&lt;id&gt;</span></pre>
  </div>

  <hr class="divider">
  <div class="footer">Uploads expire after ${escapeHtml(formatHoursDuration(ttlHours))} &middot; IPs expire after 90 days &middot; Max file size: 100 MB</div>
</div>
</div>
<script>
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
  const activeElement = document.activeElement;
  if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable)) {
    return;
  }
  const copyScope = document.getElementById('copyScope');
  const selection = window.getSelection();
  if (!copyScope || !selection) return;
  event.preventDefault();
  const range = document.createRange();
  range.selectNodeContents(copyScope);
  selection.removeAllRanges();
  selection.addRange(range);
});
</script>
</body>
</html>`;
}

interface ViewerParams {
  id: string;
  origin: string;
  meta: FileMeta;
  content: string;
  lang: string;
  isText: boolean;
  isImage: boolean;
  truncated: boolean;
  autoDetectLang: boolean;
}

function viewerPageHtml(p: ViewerParams): string {
  const escapedName = escapeHtml(p.meta.name);
  const rawUrl = `${p.origin}/${p.id}/raw`;
  const dlUrl = `${p.origin}/${p.id}/dl`;
  const highlightedPreview = p.isText
    ? renderHighlightedPreview(p.content, { lang: p.lang, autoDetectLang: p.autoDetectLang })
    : { lineHtml: [], lang: 'plaintext', text: '' };
  const codeLinesHtml = p.isText ? renderCodeLines(highlightedPreview.lineHtml) : '';
  const lineNumberWidthCh = Math.max(4, String(Math.max(1, highlightedPreview.lineHtml.length)).length + 3);
  const sizeLabel = formatBytes(p.meta.size);
  const dateLabel = formatDate(p.meta.uploaded);
  const deletionLabel = formatRemainingDuration(p.meta.expires);
  const originalTextJson = scriptJson(highlightedPreview.text);
  const languageLabel = displayLanguageLabel(highlightedPreview.lang);
  const initialLanguageChipClass = languageChipClass(highlightedPreview.lang);
  const languageLabelsJson = scriptJson({
    [highlightedPreview.lang]: languageLabel,
    plaintext: displayLanguageLabel('plaintext'),
  });
  const languageChipClassesJson = scriptJson({
    [highlightedPreview.lang]: initialLanguageChipClass,
    plaintext: languageChipClass('plaintext'),
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.meta.command ? escapeHtml(p.meta.command) : escapedName} — 0x0.gg</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${HLJS_CDN_BASE}/styles/stackoverflow-dark.min.css">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #09090b; --bg-card: #111113; --bg-elevated: #18181b;
    --code-bg: #1c1b1b;
    --border: #27272a; --border-light: #3f3f46;
    --text: #fafafa; --text-muted: #a1a1aa; --text-dim: #71717a;
    --accent: #3b82f6; --accent-hover: #2563eb;
    --highlight-bg: rgba(250, 204, 21, 0.2); --highlight-text: #fde047;
    --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
    --font-mono: monospace;
    --radius: 8px; --radius-sm: 6px;
    --toolbar-control-height: 30px;
    --code-font-size: 0.8125rem;
  }
  body {
    background: var(--bg); color: var(--text);
    font-family: var(--font-sans); min-height: 100vh;
    display: flex; flex-direction: column;
    overflow-x: clip;
  }

  /* ── Toolbar ─────────────────────────────────────── */
  .toolbar {
    background: var(--bg-elevated);
    border-bottom: 1px solid var(--border);
    padding: 0 1.25rem;
    width: 100vw;
    height: 56px;
    display: flex; align-items: center; gap: 1rem;
    position: sticky; top: 0; z-index: 100;
  }
  .toolbar-logo {
    font-family: var(--font-mono); font-weight: 600; font-size: 0.9375rem;
    color: var(--text); flex-shrink: 0;
    display: flex; align-items: center; gap: 0.5rem;
  }
  .toolbar-logo .mark {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    background: var(--accent); color: #fff; border-radius: 6px;
    font-size: 0.8125rem; font-weight: 600;
  }
  .toolbar-sep {
    width: 1px; height: 24px; background: var(--border); flex-shrink: 0;
  }
  .toolbar-meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .toolbar-filename {
    font-family: var(--font-mono); font-size: 0.8125rem; font-weight: 500;
    color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .toolbar-command {
    font-family: var(--font-mono); font-size: 0.8125rem; font-weight: 500;
    color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .toolbar-command .prompt {
    color: var(--accent); margin-right: 0.25rem;
  }
  .toolbar-date {
    font-size: 0.6875rem; color: var(--text-dim);
    white-space: nowrap;
  }
  .toolbar-expiry {
    font-size: 0.6875rem; color: #fcd34d;
    white-space: nowrap;
  }
  .toolbar-details {
    display: flex; align-items: center; gap: 0.5rem;
    min-width: 0; flex-wrap: wrap;
  }
  .language-chip {
    display: inline-flex; align-items: center;
    height: 17px; padding: 0 0.4rem;
    border: 1px solid currentColor; border-radius: 999px;
    background: transparent;
    font-family: var(--font-mono); font-size: 0.625rem; font-weight: 700;
    line-height: 1; letter-spacing: 0; text-transform: uppercase;
    white-space: nowrap;
  }
  .language-chip-blue { color: #93c5fd; border-color: rgba(147, 197, 253, 0.6); }
  .language-chip-cyan { color: #67e8f9; border-color: rgba(103, 232, 249, 0.58); }
  .language-chip-emerald { color: #86efac; border-color: rgba(134, 239, 172, 0.58); }
  .language-chip-amber { color: #fcd34d; border-color: rgba(252, 211, 77, 0.58); }
  .language-chip-rose { color: #fda4af; border-color: rgba(253, 164, 175, 0.58); }
  .language-chip-violet { color: #c4b5fd; border-color: rgba(196, 181, 253, 0.6); }
  .language-chip-teal { color: #5eead4; border-color: rgba(94, 234, 212, 0.58); }
  .language-chip-indigo { color: #a5b4fc; border-color: rgba(165, 180, 252, 0.6); }
  .language-chip-fuchsia { color: #f0abfc; border-color: rgba(240, 171, 252, 0.6); }
  .language-chip-slate { color: #cbd5e1; border-color: rgba(203, 213, 225, 0.58); }
  .toolbar-right { display: flex; align-items: center; gap: 0.5rem; margin-left: auto; flex-shrink: 0; }

  /* ── Search ──────────────────────────────────────── */
  .search-wrapper {
    display: flex; align-items: center; gap: 0.5rem;
  }
  .search-row {
    display: flex; align-items: center;
  }
  .search-box {
    position: relative; display: flex; align-items: center;
  }
  .search-icon {
    position: absolute; left: 10px;
    color: var(--text-dim); pointer-events: none;
    width: 14px; height: 14px;
  }
  .search-input {
    font-family: var(--font-mono); font-size: 0.75rem;
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text); border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    height: var(--toolbar-control-height);
    padding: 0 28px 0 30px; width: 220px;
    outline: none; transition: border-color 0.15s;
  }
  .search-input::placeholder { color: var(--text-dim); }
  .search-input:focus { border-color: var(--accent); }
  .search-clear {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    background: none; border: none; color: var(--text-dim);
    cursor: pointer; padding: 0; display: none;
    width: 16px; height: 16px; line-height: 1;
  }
  .search-clear:hover { color: var(--text); }
  .search-input:not(:placeholder-shown) + .search-clear { display: block; }
  .search-count {
    font-family: var(--font-mono); font-size: 0.6875rem;
    color: #fde68a; line-height: 1;
    min-width: 4.75rem; white-space: nowrap;
  }
  .search-count:empty { visibility: hidden; }
  .search-nav { display: flex; gap: 0; margin-left: -1px; }
  .search-nav button {
    background: transparent; border: 1px solid var(--border);
    color: var(--text-muted); border-radius: 0;
    width: 28px; height: var(--toolbar-control-height); cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: background 0.15s;
  }
  .search-nav button + button { margin-left: -1px; }
  .search-nav button:last-child { border-radius: 0 var(--radius-sm) var(--radius-sm) 0; }
  .search-nav button:hover { background: var(--bg-elevated); }

  /* ── Buttons ─────────────────────────────────────── */
  .btn {
    font-family: var(--font-mono); font-size: 0.75rem; font-weight: 500;
    background: var(--bg); border: 1px solid var(--border);
    color: var(--text-muted); border-radius: var(--radius-sm);
    min-height: var(--toolbar-control-height);
    padding: 0 12px; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
    transition: all 0.15s; text-decoration: none; white-space: nowrap;
  }
  .btn:hover { background: var(--bg-elevated); color: var(--text); border-color: var(--border-light); }
  .btn.active { background: var(--bg-elevated); color: var(--text); border-color: var(--accent); }
  .btn svg { width: 14px; height: 14px; }

  /* ── Code viewer ─────────────────────────────────── */
  .viewer {
    flex: 1; display: flex; flex-direction: column;
    overflow: auto;
  }
  .code-wrapper {
    --viewer-code-font-size: var(--code-font-size);
    --code-line-height: 1.65;
    flex: 1; overflow: hidden; position: relative;
    background: var(--code-bg);
  }
  .code-container {
    height: 100%; overflow: auto; min-width: 0;
    background: var(--code-bg);
  }
  .wrap .code-container { overflow-x: hidden; }
  .code-lines {
    min-height: 100%; min-width: max-content;
    font-family: var(--font-mono) !important;
    font-size: var(--viewer-code-font-size); line-height: var(--code-line-height);
    background: transparent !important;
    padding: 1rem 0; tab-size: 4;
  }
  .wrap .code-lines { min-width: 0; }
  .code-line {
    display: grid;
    grid-template-columns: var(--line-number-width, 4ch) minmax(0, 1fr);
    align-items: stretch;
    min-height: calc(var(--viewer-code-font-size) * var(--code-line-height));
  }
  .line-number {
    position: sticky; left: 0; z-index: 1;
    display: block; align-self: stretch;
    color: var(--text-dim); text-align: right;
    padding: 0 0.75rem 0 1rem;
    user-select: none; background: var(--code-bg);
    border-right: 1px solid var(--border);
  }
  .code-line-content {
    display: block;
    min-width: max-content;
    padding: 0 1rem;
    white-space: pre;
    font-family: var(--font-mono) !important;
    font-size: inherit;
    line-height: inherit;
    background: transparent !important;
  }
  .wrap .code-line-content {
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .code-container a.code-link {
    color: inherit; text-decoration: underline;
    text-decoration-color: var(--text-dim);
    text-underline-offset: 2px;
  }
  .code-container a.code-link:hover {
    text-decoration-color: var(--accent);
    color: var(--accent);
  }
  .hljs { background: transparent !important; }
  .sr-only {
    position: absolute; width: 1px; height: 1px;
    padding: 0; margin: -1px; overflow: hidden;
    clip: rect(0,0,0,0); white-space: nowrap; border-width: 0;
  }
  .truncated-bar {
    background: var(--bg-elevated); border-top: 1px solid var(--border);
    padding: 0.75rem 1.25rem;
    font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-dim);
    text-align: center;
  }
  .truncated-bar a { color: var(--accent); text-decoration: none; }
  .truncated-bar a:hover { text-decoration: underline; }

  /* ── Image viewer ────────────────────────────────── */
  .image-viewer {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: 2rem;
    background: repeating-conic-gradient(var(--bg-elevated) 0% 25%, var(--bg) 0% 50%) 50% / 20px 20px;
  }
  .image-viewer img {
    max-width: 100%; max-height: calc(100vh - 120px);
    border-radius: var(--radius); box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  }

  /* ── Binary message ──────────────────────────────── */
  .binary-msg {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 1rem;
    color: var(--text-dim);
  }
  .binary-msg .icon { font-size: 3rem; opacity: 0.4; }
  .binary-msg .info { font-family: var(--font-mono); font-size: 0.875rem; }
  .binary-msg .size { font-size: 0.75rem; color: var(--text-dim); }

  /* ── Search highlights (CSS Custom Highlight API) ── */
  ::highlight(search-results) {
    background: var(--highlight-bg); color: var(--highlight-text);
  }
  ::highlight(search-active) {
    background: rgba(250, 204, 21, 0.45); color: var(--highlight-text);
  }

  /* ── Responsive ──────────────────────────────────── */
  @media (max-width: 640px) {
    .search-input { width: 140px; }
    .toolbar { padding: 0 0.75rem; gap: 0.5rem; }
  }
</style>
</head>
<body>

<!-- ── Toolbar ────────────────────────────────────────── -->
<div class="toolbar">
  <div class="toolbar-logo">
    <span class="mark">0x0</span>
  </div>
  <div class="toolbar-sep"></div>
  <div class="toolbar-meta">
    ${p.meta.command ? `<div class="toolbar-command" title="${escapeHtml(p.meta.command)}"><span class="prompt">$</span>${escapeHtml(p.meta.command)}</div>` : `<div class="toolbar-filename" title="${escapedName}">${escapedName}</div>`}
    <div class="toolbar-details">
      <span class="toolbar-date" data-iso="${escapeHtml(p.meta.uploaded)}" data-size="${escapeHtml(sizeLabel)}">${escapeHtml(dateLabel)} &middot; ${escapeHtml(sizeLabel)}</span>
      ${deletionLabel ? `<span class="toolbar-expiry" data-expires="${escapeHtml(p.meta.expires || '')}">Deletes in ${escapeHtml(deletionLabel)}</span>` : ''}
      ${p.isText ? `<span class="language-chip ${escapeHtml(initialLanguageChipClass)}" id="languageBadge"><span class="sr-only">Language:</span><span id="languageBadgeText">${escapeHtml(languageLabel)}</span></span>` : ''}
    </div>
  </div>
  <div class="toolbar-right">
    ${p.isText ? `
    <div class="search-wrapper">
      <div class="search-row">
        <div class="search-box">
          <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input class="search-input" id="search" type="text" placeholder="Search…" autocomplete="off" spellcheck="false">
          <button class="search-clear" id="searchClear" title="Clear search" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>
        <div class="search-nav">
          <button id="prevMatch" title="Previous match">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m18 15-6-6-6 6"/></svg>
          </button>
          <button id="nextMatch" title="Next match">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        </div>
      </div>
      <span class="search-count" id="searchCount"></span>
    </div>
    <button class="btn active" id="wrapBtn" title="Toggle word wrap">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><path d="M3 18h7"/></svg>
      Wrap
    </button>
    <button class="btn" id="formatBtn" title="Format inline JSON in logs">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1"/><path d="M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/></svg>
      Format
    </button>
    ` : ''}
    <a class="btn" href="${rawUrl}" target="_blank">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h10v10"/><path d="M7 17 17 7"/></svg>
      Raw
    </a>
    <a class="btn" href="${dlUrl}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Download
    </a>
  </div>
</div>

<!-- ── Body ───────────────────────────────────────────── -->
<div class="viewer">
${p.isText ? `
  <div class="code-wrapper wrap" id="codeWrapper" style="--line-number-width: ${lineNumberWidthCh}ch;">
    <div class="code-container" id="codeContainer">
      <div class="code-lines hljs language-${escapeHtml(highlightedPreview.lang)}" id="codeLines" data-lang="${escapeHtml(highlightedPreview.lang)}">
        ${codeLinesHtml}
      </div>
    </div>
  </div>
  ${p.truncated ? `<div class="truncated-bar">File truncated at 2 MB. <a href="${rawUrl}">View full raw file &rarr;</a></div>` : ''}
` : p.isImage ? `
  <div class="image-viewer">
    <img src="${rawUrl}" alt="${escapedName}">
  </div>
` : `
  <div class="binary-msg">
    <div class="icon">&#128196;</div>
    <div class="info">${escapedName}</div>
    <div class="size">${formatBytes(p.meta.size)} &middot; ${escapeHtml(p.meta.type)}</div>
    <a class="btn" href="${dlUrl}" style="margin-top: 0.5rem;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      Download file
    </a>
  </div>
`}
</div>

<script>${browserDateScript()}</script>
${p.isText ? `
<script>
window.__VIEWER_DATA__ = {
  originalText: ${originalTextJson},
  languageLabels: ${languageLabelsJson},
  languageChipClasses: ${languageChipClassesJson},
};
${textViewerScript()}
</script>
` : ''}

</body>
</html>`;
}
