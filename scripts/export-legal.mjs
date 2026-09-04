// Renders src/lib/legal-content.ts into static HTML pages for the public
// site (App Store Connect requires a hosted Privacy Policy URL).
//   node scripts/export-legal.mjs <output-dir>
// Re-run after any wording change so the hosted pages match the app.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const outDir = resolve(process.argv[2] ?? '.');
const source = readFileSync(resolve('src/lib/legal-content.ts'), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const legal = {};
new Function('exports', 'require', 'module', outputText)(legal, require, { exports: legal });

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function page(title, sections, intro) {
  const body = sections
    .map((s) => `    <h2>${escape(s.heading)}</h2>\n    <p>${escape(s.body)}</p>`)
    .join('\n\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escape(title)} · ${legal.APP_NAME}</title>
  <style>
    body {
      background: #000;
      color: #ddd;
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      line-height: 1.6;
      margin: 0;
      padding: 40px 20px;
    }
    main { max-width: 640px; margin: 0 auto; }
    h1 { color: #fff; letter-spacing: 0.04em; }
    h2 { color: #fff; font-size: 18px; margin-top: 32px; }
    a { color: #fbbf24; }
    .muted { color: #888; font-size: 14px; }
    nav { margin-top: 40px; padding-top: 16px; border-top: 1px solid #222; }
    nav a { margin-right: 16px; }
  </style>
</head>
<body>
  <main>
    <h1>${escape(title)}</h1>
    <p class="muted">Effective ${escape(legal.EFFECTIVE_DATE)}${intro ? ' · ' + escape(intro) : ''}</p>

${body}

    <nav class="muted">
      <a href="privacy.html">Privacy Policy</a>
      <a href="terms.html">Terms of Service</a>
      <a href="shop-terms.html">Shop Terms</a>
      <a href="delete-account.html">Delete your account</a>
    </nav>
  </main>
</body>
</html>
`;
}

const pages = {
  'privacy.html': page('Privacy Policy', legal.PRIVACY_SECTIONS, 'How S333XHUB handles your data'),
  'terms.html': page('Terms of Service', legal.TERMS_SECTIONS, 'The rules for using S333XHUB'),
  'shop-terms.html': page('S333XSHOP Terms', legal.SHOP_TERMS_SECTIONS, 'Buying a numbered piece'),
};
for (const [name, html] of Object.entries(pages)) {
  writeFileSync(join(outDir, name), html);
  console.log('wrote', join(outDir, name));
}
