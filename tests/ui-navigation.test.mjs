import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const htmlFiles = ['index.html', 'login.html', 'register.html', 'verify-email.html', 'auth-callback.html'];
const faviconReference = '<link rel="icon" type="image/svg+xml" href="assets/recipefinder-favicon.svg">';

await access(new URL('assets/recipefinder-favicon.svg', root));
const favicon = await readFile(new URL('assets/recipefinder-favicon.svg', root), 'utf8');
assert.match(favicon, /^<svg\b/);
assert.match(favicon, /viewBox="0 0 32 32"/);
assert.match(favicon, /fill="#6740ed"/);
assert.doesNotMatch(favicon, /<script|<foreignObject|\b(?:href|xlink:href)=|data:/i);
assert.equal((favicon.match(/<svg\b/g) || []).length, 1);

for (const file of htmlFiles) {
  const html = await readFile(new URL(file, root), 'utf8');
  assert.equal(
    html.split(faviconReference).length - 1,
    1,
    `${file} must contain exactly one local RecipeFinder favicon reference`,
  );

  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${file} must not contain duplicate IDs`);
}

const index = await readFile(new URL('index.html', root), 'utf8');
assert.match(index, /class="sidebar-promo"[\s\S]*?<button data-scroll="recommended">Explore now →<\/button>/);
assert.match(index, /<button class="primary" data-scroll="recommended">Explore recipes/);

const app = await readFile(new URL('app.js', root), 'utf8');
assert.match(app, /const MOBILE_SIDEBAR_QUERY = '\(max-width: 980px\)'/);
assert.match(app, /function setSidebarOpen\(open\)/);
assert.match(app, /classList\.toggle\('open', open\)/);
assert.match(app, /setAttribute\('aria-expanded', String\(open\)\)/);
assert.match(app, /setAttribute\('aria-label', open \? 'Close menu' : 'Open menu'\)/);
assert.match(app, /function closeMobileSidebar\(\{ restoreFocus = false, focusTarget = null \} = \{\}\)/);
assert.match(app, /if \(!mobileSidebarQuery\.matches \|\| !wasOpen\) return/);

const filterHandler = app.match(/const filterButton[\s\S]*?const viewAllButton/)?.[0] || '';
assert.match(filterHandler, /applyFilter\(filterButton\.dataset\.filter\)/);
assert.match(filterHandler, /closeMobileSidebar\(\{ focusTarget: \$\('#recommended'\) \}\)/);

const scrollHandler = app.match(/const scrollButton[\s\S]*?if \(event\.target\.closest\('\.surprise-btn'\)\)/)?.[0] || '';
assert.match(scrollHandler, /scrollButton\.closest\('\.sidebar-promo'\)/);
assert.match(scrollHandler, /restoreDiscoverView\('recommended', false\)/);
assert.match(scrollHandler, /closeMobileSidebar\(\{ focusTarget: \$\('#recommended'\) \}\)/);
assert.match(scrollHandler, /document\.getElementById\(scrollButton\.dataset\.scroll\)/, 'Hero scrolling must remain separate');

const navigation = app.match(/function initializeNavigation\(\)[\s\S]*?\n\}/)?.[0] || '';
assert.match(navigation, /closeMobileSidebar\(\{ restoreFocus: true \}\)/);
assert.match(navigation, /event\.key === 'Escape'[\s\S]*?closeMobileSidebar\(\{ restoreFocus: true \}\)/);
assert.match(navigation, /mobileSidebarQuery\.addEventListener\('change'/);
assert.match(navigation, /if \(!event\.matches\) setSidebarOpen\(false\)/);

assert.doesNotMatch(app, /innerHTML\s*=|insertAdjacentHTML|document\.write/);
assert.doesNotMatch(app, /fetch\s*\(|XMLHttpRequest|WebSocket|signUp|signIn|exchangeCodeForSession/);

console.log('Offline favicon and responsive sidebar wiring tests passed.');
