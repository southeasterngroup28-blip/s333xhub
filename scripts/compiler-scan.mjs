// React Compiler regression scan.
//
// Runs babel-plugin-react-compiler (the same plugin babel-preset-expo wires
// in when app.json sets experiments.reactCompiler) over every src/**/*.tsx
// file, in `infer` mode with panics off, and prints every function the
// compiler refused with its name and reason. Exits 1 if any component in
// MUST_COMPILE stops reporting CompileSuccess.
//
// No new dependency: @babel/core, @babel/preset-typescript and
// babel-plugin-react-compiler all arrive with expo / babel-preset-expo.
//
//   node scripts/compiler-scan.mjs            # summary + every bailout
//   node scripts/compiler-scan.mjs --verbose  # also every success

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const { parse } = require('@babel/parser');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const verbose = process.argv.includes('--verbose');

/**
 * Components that must keep compiling: the press acknowledgments, the two
 * typing forms, the feed card, the mini-player, and the two memoised rows
 * that isolate keystrokes and taps. Keyed by file so a same-named function
 * elsewhere (chat's Composer) does not stand in for the one we care about.
 */
const MUST_COMPILE = [
  ['src/components/ui/scale-pressable.tsx', 'ScalePressable'],
  ['src/app/(tabs)/_layout.tsx', 'TabButton'],
  ['src/components/post-card.tsx', 'ReactionChip'],
  ['src/components/post-card.tsx', 'UnlockPill'],
  ['src/components/post-card.tsx', 'PostCard'],
  ['src/app/compose.tsx', 'ComposeScreen'],
  ['src/app/(tabs)/fanmail.tsx', 'FanMailScreen'],
  ['src/components/mini-player.tsx', 'MiniPlayer'],
  ['src/app/post/[id].tsx', 'Composer'],
  ['src/app/channel/[id].tsx', 'RunRow'],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const OPT_OUT = new Set(['use no memo', 'use no forget']);

/**
 * The compiler's error/skip events carry a location but no name, so map
 * every function's start position to the name it is declared under
 * (declaration id, `const X = ...`, `memo(function X ...)`, or a property).
 * Also collects the functions that opt out with 'use no memo': the plugin
 * still logs their compile errors, and those are deliberate, not regressions.
 */
function functionNames(code) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });
  const names = new Map();
  const optedOut = new Set();
  const key = (loc) => `${loc.start.line}:${loc.start.column}`;
  const nameOf = (node, parent) => {
    if (node.id?.name) return node.id.name;
    if (!parent) return null;
    if (parent.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') return parent.id.name;
    if (parent.type === 'AssignmentExpression' && parent.left?.type === 'Identifier') return parent.left.name;
    if (
      (parent.type === 'ObjectProperty' || parent.type === 'ClassMethod' || parent.type === 'ObjectMethod') &&
      parent.key?.type === 'Identifier'
    )
      return parent.key.name;
    if (parent.type === 'ExportDefaultDeclaration') return 'default';
    return null;
  };
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const name = nameOf(node, parent);
      if (name && node.loc) names.set(key(node.loc), name);
      const directives = node.body?.directives ?? [];
      if (node.loc && directives.some((d) => OPT_OUT.has(d.value?.value))) optedOut.add(key(node.loc));
    }
    for (const k of Object.keys(node)) {
      if (k === 'loc' || k === 'start' || k === 'end' || k === 'leadingComments' || k === 'trailingComments')
        continue;
      const v = node[k];
      if (Array.isArray(v)) for (const c of v) visit(c, node);
      else if (v && typeof v.type === 'string') visit(v, node);
    }
  };
  visit(ast.program, null);
  return { names, optedOut, key };
}

const events = [];
const files = walk(SRC);
let parseFailures = 0;

for (const file of files) {
  const code = readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  const { names, optedOut, key } = functionNames(code);
  const nameAt = (loc) => (loc ? (names.get(key(loc)) ?? `(anonymous @ ${loc.start.line}:${loc.start.column})`) : '(unknown)');
  const optedOutAt = (loc) => !!loc && optedOut.has(key(loc));
  try {
    babel.transformSync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      sourceType: 'module',
      // The compiler runs as a plugin, i.e. before the preset strips types:
      // the same order babel-preset-expo uses.
      plugins: [
        [
          require('babel-plugin-react-compiler'),
          {
            compilationMode: 'infer',
            panicThreshold: 'none',
            target: '19',
            customOptOutDirectives: ['use no memo', 'use no forget', 'widget'],
            logger: {
              logEvent: (_filename, e) => {
                if (e.kind === 'Timing') return;
                events.push({ file: rel, fn: nameAt(e.fnLoc), e, optedOut: optedOutAt(e.fnLoc) });
              },
            },
          },
        ],
      ],
      presets: [[require('@babel/preset-typescript'), { isTSX: true, allExtensions: true }]],
      code: false,
      ast: false,
    });
  } catch (err) {
    parseFailures += 1;
    console.error(`! ${rel}: ${err.message.split('\n')[0]}`);
  }
}

const successes = events.filter(({ e }) => e.kind === 'CompileSuccess');
const isBail = ({ e }) => e.kind === 'CompileError' || e.kind === 'PipelineError';
const bailouts = events.filter((x) => isBail(x) && !x.optedOut);
// Deliberate: a 'use no memo' function, whether it compiled cleanly (the
// plugin's own CompileSkip) or the plugin logged the error it opts out of.
const skips = events.filter((x) => x.e.kind === 'CompileSkip' || (isBail(x) && x.optedOut));

function reasonOf(e) {
  if (e.kind === 'CompileError') {
    const d = e.detail;
    const reason = d.reason ?? d.options?.reason ?? d.category ?? 'unknown';
    const desc = d.description ?? d.options?.description ?? '';
    const loc = d.loc ?? d.options?.loc ?? d.primaryLocation?.() ?? null;
    const at = loc && typeof loc === 'object' && loc.start ? ` (line ${loc.start.line})` : '';
    return `${reason}${desc ? ': ' + desc : ''}${at}`;
  }
  if (e.kind === 'PipelineError') return `pipeline: ${e.data}`;
  if (e.kind === 'CompileSkip') return e.reason;
  return e.kind;
}

if (verbose) {
  for (const { file, fn, e } of successes) {
    console.log(`ok   ${file} ${fn} (${e.memoSlots} slots)`);
  }
}
for (const { file, fn, e, optedOut } of skips) {
  const why = reasonOf(e).split('\n')[0];
  console.log(`skip ${file} ${fn}: ${optedOut ? "'use no memo' (deliberate); " : ''}${why}`);
}
for (const { file, fn, e } of bailouts) {
  console.log(`BAIL ${file} ${fn}: ${reasonOf(e)}`);
}

console.log(
  `\n${files.length} files: ${successes.length} compiled, ${bailouts.length} bailouts, ${skips.length} skipped by directive` +
    (parseFailures ? `, ${parseFailures} failed to parse` : '')
);

let failed = false;
for (const [file, fn] of MUST_COMPILE) {
  const ok = successes.some((s) => s.file === file && s.fn === fn);
  if (!ok) {
    failed = true;
    const why = events.find((x) => x.file === file && x.fn === fn && x.e.kind !== 'CompileSuccess');
    console.log(`FAIL ${file} ${fn} must compile${why ? `: ${reasonOf(why.e)}` : ' (no compiler event seen)'}`);
  }
}
if (failed || parseFailures) process.exit(1);
console.log('All required components compile.');
