import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { Script } from 'node:vm';

const html = readFileSync(new URL('../mabiat-menu.html', import.meta.url), 'utf8');
assert.match(html, /<html lang="ar" dir="rtl">/);
assert.match(html, /<main\b[\s\S]*<\/main>/);
assert.match(html, /<nav class="menu-grid" aria-label="قائمة المبيعات">/);
assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);

const links = [...html.matchAll(/<a href="([^"]+)" class="menu-card">/g)].map(x => x[1]);
assert.deepEqual(links, ['sales-invoice.html', 'sales-history.html']);
for (const target of links) {
  assert(existsSync(new URL('../' + target, import.meta.url)), 'Missing linked page: ' + target);
}
assert.doesNotMatch(html, /href="javascript:/i, 'Never use javascript: links');
for (const id of ['refreshBtn', 'backBtn']) {
  assert.match(html, new RegExp('<button[^>]*id="' + id + '"[^>]*aria-label="[^"]+"'));
  assert.match(html, new RegExp("getElementById\\('" + id + "'\\)"));
}
assert.match(html, /document\.referrer/);
assert.match(html, /new URL\(document\.referrer\)\.origin === window\.location\.origin/);
assert.match(html, /window\.location\.assign\('index\.html'\)/);
assert.match(html, /window\.location\.reload\(\)/);
assert.match(html, /navigator\.serviceWorker\.register\('\.\/sw\.js'\)/);
assert.match(html, /@media \(max-width: 650px\)/);
assert.match(html, /@media \(max-width: 360px\)/);
assert.match(html, /prefers-reduced-motion: reduce/);
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, 'Expected one inline application script');
new Script(scripts[0][1], { filename: 'sales-menu-inline.js' });
console.log('Sales menu regression checks passed.');
