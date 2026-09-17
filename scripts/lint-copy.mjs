#!/usr/bin/env node
// Copy lint: keeps the house voice from drifting back.
//
//   node scripts/lint-copy.mjs                 scans src/**/*.{ts,tsx} and
//                                              supabase/functions/**/*.ts
//   node scripts/lint-copy.mjs src supabase/functions ../s333xgod ../ronso
//                                              adds the two sites' *.html
//   node scripts/lint-copy.mjs --strict        pending files fail too (the
//                                              list is empty; kept for the
//                                              next parallel pass)
//
// What it scans: string literals, template literals and JSX text in the
// app source and the edge functions (comments never count; the functions
// write push bodies, email subjects and Stripe receipt lines, which are
// fan-facing too), and body text plus <title> and meta content in the site
// pages (scripts, styles and HTML comments never count). What it flags: an
// em-dash, an en-dash, a spaced hyphen, &mdash;, &ndash;, an arrow, and the
// four curly quote characters. Ranges are written "5 to 7"; sentences are
// split at the dash; quotes are straight.
//
// Exit code 1 on any hit outside the allowlist. Runs in CI.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const ROOT = resolve(process.cwd());

// ---- what counts as a hit -------------------------------------------

const RULES = [
  { name: 'em-dash', test: /—/ },
  { name: 'en-dash', test: /–/ },
  { name: 'spaced hyphen', test: / - / },
  { name: '&mdash;', test: /&mdash;/ },
  { name: '&ndash;', test: /&ndash;/ },
  { name: 'arrow', test: /→/ },
  { name: 'curly quote', test: /[‘’“”]/ },
];

// Exact literals that are allowed, by file. Keep this list short and
// say why each entry is here.
const ALLOW = [
  // The artist-only "not loaded yet" count placeholder on a show row.
  { file: 'src/app/(tabs)/shows.tsx', text: '–' },
];

// Files a parallel pass owns right now, if any. Their hits are reported
// but do not fail the run until --strict. Empty once that pass lands and
// the copy edits are applied to them.
const PENDING = [];

// ---- walking -----------------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---- the TypeScript side: strings, templates and JSX text ----------------

/** Characters after which a `<` opens JSX rather than a comparison or a generic. */
const JSX_OPENERS = new Set(['(', '{', ',', '?', ':', '=', '>', '}', '[', '&', '|', '!', ';']);
/** Characters after which a `/` starts a regex literal rather than a division. */
const REGEX_OPENERS = new Set(['=', '(', ',', ':', ';', '!', '&', '|', '?', '{', '}', '[', '']);

/**
 * A small scanner over TS/TSX source. Yields every string literal's
 * contents (quotes stripped, `${...}` holes cut out) and every run of
 * JSX text, each with the line it starts on. Comments are skipped
 * entirely, so a dash in a comment never counts.
 */
function* textsInSource(src) {
  let i = 0;
  let line = 1;
  const n = src.length;
  /** The last non-space character read as code. */
  let last = '';
  /** The last identifier completed as code (`return` makes the next `<` JSX). */
  let lastWord = '';
  let word = '';

  const advance = (k = 1) => {
    for (let j = 0; j < k; j++) {
      if (src[i] === '\n') line++;
      i++;
    }
  };

  const note = (c) => {
    if (/[A-Za-z0-9_$]/.test(c)) {
      word += c;
    } else {
      if (word) lastWord = word;
      word = '';
    }
    if (!/\s/.test(c)) last = c;
  };

  /** A quoted string from the opening quote to just past the closing one. */
  const readQuoted = (quote) => {
    const start = line;
    advance();
    let text = '';
    while (i < n && src[i] !== quote && src[i] !== '\n') {
      if (src[i] === '\\') {
        text += src[i + 1] ?? '';
        advance(2);
        continue;
      }
      text += src[i];
      advance();
    }
    advance();
    note(quote);
    return { text, line: start };
  };

  /** A template literal; `${}` holes are read as code so nested strings still count. */
  function* readTemplate() {
    const start = line;
    advance();
    let text = '';
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') {
        text += src[i + 1] ?? '';
        advance(2);
        continue;
      }
      if (src[i] === '$' && src[i + 1] === '{') {
        advance(2);
        yield* readCode('}');
        continue;
      }
      text += src[i];
      advance();
    }
    advance();
    note('`');
    yield { text, line: start };
  }

  const skipRegex = () => {
    advance();
    let inClass = false;
    while (i < n && src[i] !== '\n') {
      if (src[i] === '\\') {
        advance(2);
        continue;
      }
      if (src[i] === '[') inClass = true;
      else if (src[i] === ']') inClass = false;
      else if (src[i] === '/' && !inClass) break;
      advance();
    }
    advance();
    while (i < n && /[a-z]/.test(src[i])) advance();
    note('/');
  };

  /** From `<` to just past `>`. Returns what kind of tag it was. */
  function* readJsxTag() {
    advance(); // <
    const closing = src[i] === '/';
    let selfClosing = false;
    while (i < n && src[i] !== '>') {
      const c = src[i];
      if (c === '"' || c === "'") {
        yield readQuoted(c);
        continue;
      }
      if (c === '{') {
        advance();
        yield* readCode('}');
        continue;
      }
      if (c === '/' && src[i + 1] === '>') selfClosing = true;
      advance();
    }
    advance(); // >
    note('>');
    return { closing, selfClosing };
  }

  /** A whole JSX element: its tag, its children (text, holes, nested tags), its closing tag. */
  function* readJsxElement() {
    const tag = yield* readJsxTag();
    if (tag.closing || tag.selfClosing) return;
    while (i < n) {
      if (src[i] === '{') {
        advance();
        yield* readCode('}');
        continue;
      }
      if (src[i] === '<') {
        if (src[i + 1] === '/') {
          yield* readJsxTag();
          return;
        }
        yield* readJsxElement();
        continue;
      }
      const start = line;
      let text = '';
      while (i < n && src[i] !== '<' && src[i] !== '{') {
        text += src[i];
        advance();
      }
      if (/[A-Za-z]/.test(text)) yield { text, line: start };
    }
  }

  /** Code until `until` at depth 0 (or the end of file), yielding every string met. */
  function* readCode(until) {
    let depth = 0;
    while (i < n) {
      const c = src[i];
      const next = src[i + 1];
      if (until && c === until && depth === 0) {
        advance();
        note(c);
        return;
      }
      if (c === '/' && next === '/') {
        while (i < n && src[i] !== '\n') advance();
        continue;
      }
      if (c === '/' && next === '*') {
        advance(2);
        while (i < n && !(src[i] === '*' && src[i + 1] === '/')) advance();
        advance(2);
        continue;
      }
      if (c === "'" || c === '"') {
        yield readQuoted(c);
        continue;
      }
      if (c === '`') {
        yield* readTemplate();
        continue;
      }
      if (c === '/' && REGEX_OPENERS.has(last)) {
        skipRegex();
        continue;
      }
      if (c === '<' && /[A-Za-z>]/.test(next ?? '')) {
        const opens =
          JSX_OPENERS.has(last) || last === '' || (/[A-Za-z]/.test(last) && lastWord === 'return');
        if (opens) {
          yield* readJsxElement();
          continue;
        }
      }
      if (c === '{') depth++;
      if (c === '}') depth--;
      note(c);
      advance();
    }
  }

  yield* readCode();
}

// ---- the HTML side: body text, titles, meta content ---------------------

function* textsInHtml(html) {
  const blank = (m) => '\n'.repeat(m.split('\n').length - 1);
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, blank)
    .replace(/<style[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--[\s\S]*?-->/g, blank);
  let m;
  // Attribute text that reads as copy: titles, alt text, meta content.
  const attr = /\b(?:content|alt|title|placeholder)="([^"]*)"/g;
  while ((m = attr.exec(stripped))) {
    yield { text: m[1], line: stripped.slice(0, m.index).split('\n').length };
  }
  // Text nodes.
  const node = />([^<]+)</g;
  while ((m = node.exec(stripped))) {
    if (/[A-Za-z]/.test(m[1])) {
      yield { text: m[1], line: stripped.slice(0, m.index).split('\n').length };
    }
  }
}

// ---- run --------------------------------------------------------------

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const targets = args.filter((a) => !a.startsWith('--'));
if (targets.length === 0) targets.push('src', 'supabase/functions');

const hits = [];
for (const target of targets) {
  const base = resolve(ROOT, target);
  const files = walk(base).filter((f) => /\.(ts|tsx|html)$/.test(f) && !/\.d\.ts$/.test(f));
  for (const file of files) {
    const rel = relative(ROOT, file).split(sep).join('/');
    const src = readFileSync(file, 'utf8');
    const texts = file.endsWith('.html') ? textsInHtml(src) : textsInSource(src);
    for (const { text, line } of texts) {
      for (const rule of RULES) {
        if (!rule.test.test(text)) continue;
        if (ALLOW.some((a) => rel.endsWith(a.file) && a.text === text)) continue;
        hits.push({ file: rel, line, rule: rule.name, text: text.trim().slice(0, 90) });
        break;
      }
    }
  }
}

const isPending = (file) => PENDING.some((p) => file.includes(p));
const failing = hits.filter((h) => strict || !isPending(h.file));
const pending = hits.filter((h) => !strict && isPending(h.file));

for (const h of [...failing, ...pending]) {
  const tag = isPending(h.file) && !strict ? 'pending' : 'FAIL';
  console.log(`${tag}  ${h.file}:${h.line}  [${h.rule}]  ${JSON.stringify(h.text)}`);
}
if (pending.length > 0) {
  console.log(`\n${pending.length} hit(s) in pending files (not failing until their merge lands; --strict to fail).`);
}
if (failing.length > 0) {
  console.log(`\n${failing.length} copy hit(s). Split at the dash, write ranges as "5 to 7", use straight quotes.`);
  process.exit(1);
}
console.log(`copy lint: clean (${targets.join(', ')})`);
