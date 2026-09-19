// Renders src/lib/legal-content.ts into static HTML pages for the public
// site (App Store Connect requires a hosted Privacy Policy URL).
//   node scripts/export-legal.mjs <output-dir>
// Re-run after any wording change so the hosted pages match the app.
// The pages link the site's shared stylesheet (site.css in the output
// directory), so the chrome is edited there, not here.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const outDir = resolve(process.argv[2] ?? '.');

/** Evaluates one dependency-free TS module from src and returns its exports. */
function load(file) {
  const source = readFileSync(resolve(file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  new Function('exports', 'require', 'module', outputText)(exports, require, { exports });
  return exports;
}
const legal = load('src/lib/legal-content.ts');
// The canonical URL of every page: the same site the app links to.
const { PUBLIC_SITE_URL } = load('src/constants/links.ts');

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The tab icon: the app's cross on a black tile, inline so the site has no
// binary assets. The four hand-written pages carry the same line.
const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2064%2064'%3E%3Crect%20width='64'%20height='64'%20rx='12'%20fill='%23000'/%3E%3Crect%20x='29'%20y='11'%20width='6'%20height='42'%20fill='%23fff'/%3E%3Crect%20x='17'%20y='23'%20width='30'%20height='6'%20fill='%23fff'/%3E%3C/svg%3E";

// The site's bottom nav. A page never links to itself.
const NAV = [
  ['privacy.html', 'Privacy Policy'],
  ['terms.html', 'Terms of Service'],
  ['shop-terms.html', 'Shop Terms'],
  ['delete-account.html', 'Delete your account'],
];

function page(file, title, sections) {
  const body = sections
    .map((s) => `    <h2>${escape(s.heading)}</h2>\n    <p>${escape(s.body)}</p>`)
    .join('\n\n');
  const nav = NAV.filter(([href]) => href !== file)
    .map(([href, label]) => `      <a href="${href}">${label}</a>`)
    .join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escape(title)} · ${legal.APP_NAME}</title>
  <link rel="canonical" href="${PUBLIC_SITE_URL}/${file}" />
  <link rel="icon" href="${FAVICON}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Anton&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="site.css" />
</head>
<body>
  <main>
    <header>
      <a class="wordmark" href="index.html">${legal.APP_NAME}</a>
      <span class="dim small">iPhone</span>
    </header>
    <h1>${escape(title)}</h1>
    <p class="dim small">Effective ${escape(legal.EFFECTIVE_DATE)}</p>

${body}

    <nav>
${nav}
    </nav>
    <footer>&copy; 2026 ${escape(legal.OPERATOR_NAME)}. All rights reserved.</footer>
  </main>
</body>
</html>
`;
}

const pages = {
  'privacy.html': page('privacy.html', 'Privacy Policy', legal.PRIVACY_SECTIONS),
  'terms.html': page('terms.html', 'Terms of Service', legal.TERMS_SECTIONS),
  'shop-terms.html': page('shop-terms.html', 'Shop Terms', legal.SHOP_TERMS_SECTIONS),
};
for (const [name, html] of Object.entries(pages)) {
  writeFileSync(join(outDir, name), html);
  console.log('wrote', join(outDir, name));
}
