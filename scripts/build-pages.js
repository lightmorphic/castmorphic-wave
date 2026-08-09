'use strict';

// Builds the GitHub Pages variant of the website into the given folder.
// The /site folder is written for the Site Manager platform, which wires
// up the contact form and generates the blog at import. GitHub Pages is
// plain static hosting, so this build:
//   - removes the Blog menu item (no platform to generate the blog)
//   - swaps the contact form for email + GitHub issue links
//
// Run with: node scripts/build-pages.js <output-folder>

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/build-pages.js <output-folder>');
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(SITE, out, { recursive: true });

const indexPath = path.join(out, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// No platform blog on Pages.
const blogLink = /\s*<a href="blog\.html">Blog<\/a>/;
if (!blogLink.test(html)) throw new Error('blog nav link not found');
html = html.replace(blogLink, '');

// The form only works on the Site Manager platform; on Pages, offer
// direct ways to get in touch instead.
const formStart = html.indexOf('<form class="panel"');
const formEnd = html.indexOf('</form>') + '</form>'.length;
if (formStart < 0 || formEnd < formStart) throw new Error('contact form not found');
html = html.slice(0, formStart) +
`<div class="panel contact-links">
      <p><strong>Email:</strong>
        <a href="mailto:claude@charlie.cx">claude@charlie.cx</a></p>
      <p><strong>Bugs and ideas:</strong>
        <a href="https://github.com/lightmorphic/waveframe/issues">open an issue on GitHub</a></p>
      <p class="fine">Both land with a real person. Plain descriptions beat
      perfect bug reports; say what you did and what happened.</p>
    </div>` +
  html.slice(formEnd);

fs.writeFileSync(indexPath, html);

// Tell Pages to serve files as they are, no Jekyll pass.
fs.writeFileSync(path.join(out, '.nojekyll'), '');

console.log(`Pages build written to ${out}`);
