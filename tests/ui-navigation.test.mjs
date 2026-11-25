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
const styles = await readFile(new URL('styles.css', root), 'utf8');
const renderSource = await readFile(new URL('js/render.js', root), 'utf8');
assert.match(index, /class="sidebar-promo"[\s\S]*?<button data-scroll="recommended">Explore now →<\/button>/);
assert.match(index, /<button class="primary" data-scroll="recommended">Explore recipes/);
assert.match(index, /data-dashboard-auth[\s\S]*?data-auth-sign-in[\s\S]*?data-auth-logout/);
assert.match(index, /<script type="module" src="app\.js"><\/script>/);
assert.doesNotMatch(index, /<script type="module" src="js\/dashboard-auth\.js"><\/script>/);

const topbar = index.match(/<header class="topbar">([\s\S]*?)<\/header>/)?.[1] || '';
const searchForm = topbar.match(/<form class="search-tools"[\s\S]*?<\/form>/)?.[0] || '';
assert.ok(searchForm.includes('id="search-input"'));
assert.doesNotMatch(searchForm, /search-source-panel/,
  'The recipe source controls belong below the desktop search and account row');
assert.ok(topbar.indexOf('data-dashboard-auth') < topbar.indexOf('class="search-source-panel"'));
assert.match(topbar, /id="search-source-selector"/);
assert.match(styles, /\.topbar\{display:grid;grid-template-columns:minmax\(0,1fr\) 84px auto/);
assert.match(styles, /\.search-source-panel\{grid-column:1 \/ -1;grid-row:2/);
assert.match(styles, /@media\(min-width:981px\) and \(max-width:1199px\)/);
assert.match(styles, /@media\(min-width:681px\) and \(max-width:980px\)/);
assert.match(styles, /@media\(max-width:680px\)[\s\S]*?\.search-source-panel\{grid-row:4\}/);
assert.match(styles, /\.rightbar\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
assert.match(styles, /body\.dark\{--sidebar-link:#d5cfee\}/);
const focusOrder = ['id="search-form"', 'id="menu-btn"', 'id="theme-toggle"', 'data-dashboard-auth']
  .map((marker) => topbar.indexOf(marker));
assert.ok(focusOrder.every((position) => position >= 0));
assert.deepEqual([...focusOrder].sort((a, b) => a - b), focusOrder,
  'The header DOM order must follow its responsive visual order');
for (const selector of ['search-tools', 'theme-toggle', 'dashboard-auth']) {
  assert.doesNotMatch(styles, new RegExp(`\\.${selector}\\{order:`),
    `${selector} must not be visually reordered away from keyboard focus order`);
}
assert.match(styles, /\.compact-grid \.view-btn\{display:block\}/);
assert.doesNotMatch(styles, /\.compact-grid \.card-body p,\.compact-grid \.view-btn\{display:none\}/);
assert.match(renderSource, /viewButton\.dataset\.view = recipe\.id/);
assert.match(renderSource, /View recipe for \$\{recipe\.name\}/);

const app = await readFile(new URL('app.js', root), 'utf8');
const resetExternalDiscovery = app.match(/function resetExternalDiscovery[\s\S]*?\n\}/)?.[0] || '';
assert.match(resetExternalDiscovery, /resetSource = true/);
assert.match(resetExternalDiscovery, /if \(resetSource\) setSearchSource\('offline'\)/, 'Shared resets must restore Offline search');
assert.equal((app.match(/function setActiveNavigation\(/g) || []).length, 1, 'Navigation state must use one shared helper');
const activeNavigation = app.match(/function setActiveNavigation\(section\)[\s\S]*?\n\}/)?.[0] || '';
assert.match(activeNavigation, /links\.find\(\(link\) => link\.dataset\.section === section\)/);
assert.match(activeNavigation, /classList\.toggle\('active', active\)/);
assert.match(activeNavigation, /setAttribute\('aria-current', 'page'\)/);
assert.match(activeNavigation, /removeAttribute\('aria-current'\)/);
assert.match(activeNavigation, /return Boolean\(activeLink\)/, 'Unknown sections must leave no misleading active item');

const fakeNavigationLinks = ['home', 'recommended', 'categories', 'cuisines', 'favorites'].map((section) => ({
  dataset: { section },
  active: false,
  attributes: {},
  classList: { toggle(_name, active) { this.owner.active = active; }, owner: null },
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
}));
fakeNavigationLinks.forEach((link) => { link.classList.owner = link; });
const executableNavigationHelper = Function('$$', `${activeNavigation}\nreturn setActiveNavigation;`)(() => fakeNavigationLinks);
assert.equal(executableNavigationHelper('favorites'), true);
assert.deepEqual(fakeNavigationLinks.filter((link) => link.active).map((link) => link.dataset.section), ['favorites']);
assert.equal(fakeNavigationLinks.find((link) => link.active).attributes['aria-current'], 'page');
assert.ok(fakeNavigationLinks.filter((link) => !link.active).every((link) => !('aria-current' in link.attributes)));
assert.equal(executableNavigationHelper('unknown-section'), false);
assert.equal(fakeNavigationLinks.filter((link) => link.active).length, 0);
assert.ok(fakeNavigationLinks.every((link) => !('aria-current' in link.attributes)));

assert.equal((app.match(/function restoreDiscoveryCollection\(/g) || []).length, 1, 'Discovery state must use one shared restoration helper');
const restoreDiscoveryCollection = app.match(/function restoreDiscoveryCollection\(\)[\s\S]*?\n\}/)?.[0] || '';
assert.match(restoreDiscoveryCollection, /resetExternalDiscovery\(\)/);
assert.match(restoreDiscoveryCollection, /clearFilters\(\)/);
assert.match(restoreDiscoveryCollection, /\$\('#search-input'\)\.value = ''/);
assert.match(restoreDiscoveryCollection, /renderDashboard\(\)/);
assert.doesNotMatch(restoreDiscoveryCollection, /discoverExternalRecipes|setActiveNavigation|scrollIntoView|\.focus\(|location|history|closeMobileSidebar/);

const restorationCalls = [];
const fakeSearchInput = { value: 'saved query' };
const executeRestoration = Function(
  'resetExternalDiscovery',
  'clearFilters',
  '$',
  'renderDashboard',
  `${restoreDiscoveryCollection}\nreturn restoreDiscoveryCollection;`,
)(
  () => restorationCalls.push('reset'),
  () => restorationCalls.push('clear'),
  (selector) => {
    assert.equal(selector, '#search-input');
    restorationCalls.push('input');
    return fakeSearchInput;
  },
  () => restorationCalls.push('render'),
);
executeRestoration();
assert.deepEqual(restorationCalls, ['reset', 'clear', 'input', 'render']);
assert.equal(fakeSearchInput.value, '');

const showRecipeCollection = app.match(/function showRecipeCollection\(view\)[\s\S]*?\n\}/)?.[0] || '';
assert.match(showRecipeCollection, /setActiveNavigation\(view === 'favorites' \? 'favorites' : 'recommended'\)/);
const restoreDiscoverView = app.match(/function restoreDiscoverView[\s\S]*?\n\}/)?.[0] || '';
assert.match(restoreDiscoverView, /restoreDiscoveryCollection\(\)/);
assert.match(restoreDiscoverView, /setActiveNavigation\('recommended'\)/);
const showAllCuisines = app.match(/function showAllCuisines[\s\S]*?\n\}/)?.[0] || '';
assert.match(showAllCuisines, /restoreDiscoveryCollection\(\)/);
assert.match(showAllCuisines, /setActiveNavigation\('cuisines'\)/);

assert.match(app, /const MOBILE_SIDEBAR_QUERY = '\(max-width: 980px\)'/);
assert.match(app, /function setSidebarOpen\(open\)/);
assert.match(app, /classList\.toggle\('open', expanded\)/);
assert.match(app, /setAttribute\('aria-expanded', String\(expanded\)\)/);
assert.match(app, /setAttribute\('aria-label', expanded \? 'Close menu' : 'Open menu'\)/);
assert.match(app, /function closeMobileSidebar\(\{ restoreFocus = false, focusTarget = null \} = \{\}\)/);
assert.match(app, /if \(!mobileSidebarQuery\.matches \|\| !wasOpen\) return/);

const filterHandler = app.match(/const filterButton[\s\S]*?const viewAllButton/)?.[0] || '';
assert.match(filterHandler, /applyFilter\(filterButton\.dataset\.filter\)/);
assert.match(filterHandler, /closeMobileSidebar\(\{ focusTarget: \$\('#recommended'\) \}\)/);

const viewAllHandler = app.match(/const viewAllButton[\s\S]*?data-back-to-discover/)?.[0] || '';
assert.match(viewAllHandler, /target === 'categories'[\s\S]*?restoreDiscoveryCollection\(\)[\s\S]*?setActiveNavigation\('categories'\)[\s\S]*?toggleCategoriesExpansion\(\)/);
assert.match(viewAllHandler, /target === 'cuisines'[\s\S]*?showAllCuisines\(\)/);
assert.match(viewAllHandler, /showRecipeCollection\(target === 'favorites' \? 'favorites' : 'all'\)/);
assert.equal((index.match(/data-view-all="recipes"/g) || []).length, 2, 'Both recipe View all controls must share the all-recipes path');

const scrollHandler = app.match(/const scrollButton[\s\S]*?if \(event\.target\.closest\('\.surprise-btn'\)\)/)?.[0] || '';
assert.match(scrollHandler, /scrollButton\.closest\('\.sidebar-promo'\)/);
assert.match(scrollHandler, /restoreDiscoverView\('recommended', false\)/);
assert.match(scrollHandler, /closeMobileSidebar\(\{ focusTarget: \$\('#recommended'\) \}\)/);
assert.match(scrollHandler, /document\.getElementById\(scrollButton\.dataset\.scroll\)/, 'Hero scrolling must remain separate');

const navigation = app.match(/function initializeNavigation\(\)[\s\S]*?\n\}/)?.[0] || '';
assert.match(navigation, /setActiveNavigation\('home'\)/);
assert.match(navigation, /setActiveNavigation\(link\.dataset\.section\)/);
assert.equal((navigation.match(/link\.addEventListener\('click'/g) || []).length, 1, 'Navigation links must have one click listener');
assert.match(navigation, /section === 'home'[\s\S]*?event\.preventDefault\(\)[\s\S]*?restoreDiscoveryCollection\(\)/);
assert.match(navigation, /\$\('\.page'\)\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
assert.match(navigation, /window\.location\.hash !== '#home'[\s\S]*?window\.history\.replaceState\(null, '', '#home'\)/);
assert.match(navigation, /section === 'recommended'[\s\S]*?restoreDiscoveryCollection\(\)/);
assert.match(navigation, /section === 'categories' \|\| link\.dataset\.section === 'cuisines'[\s\S]*?restoreDiscoveryCollection\(\)/);
assert.match(navigation, /section === 'favorites'[\s\S]*?showRecipeCollection\('favorites'\)/);
assert.match(navigation, /closeMobileSidebar\(\{ restoreFocus: true \}\)/);
assert.match(navigation, /event\.key === 'Escape'[\s\S]*?closeMobileSidebar\(\{ restoreFocus: true \}\)/);
assert.match(navigation, /mobileSidebarQuery\.addEventListener\('change'/);
assert.match(navigation, /const focusWasInSidebar = event\.matches && \$\('#sidebar'\)\.contains\(document\.activeElement\)/);
assert.match(navigation, /if \(focusWasInSidebar\) \$\('#menu-btn'\)\.focus\(\)/);

const sidebarHelper = app.match(/function setSidebarOpen\(open\)[\s\S]*?\n\}/)?.[0] || '';
const closeSidebarHelper = app.match(/function closeMobileSidebar\([\s\S]*?\n\}/)?.[0] || '';
const sidebarAttributes = {};
const menuAttributes = {};
const documentState = { activeElement: null };
const firstSidebarLink = { focus() { documentState.activeElement = this; } };
const menu = {
  listeners: {},
  setAttribute(name, value) { menuAttributes[name] = value; },
  addEventListener(name, listener) { this.listeners[name] = listener; },
  focus() { documentState.activeElement = this; },
  contains(element) { return element === this; },
};
const sidebar = {
  open: false,
  inert: false,
  listeners: {},
  classList: {
    toggle(_name, value) { sidebar.open = value; },
    contains() { return sidebar.open; },
  },
  setAttribute(name, value) { sidebarAttributes[name] = value; },
  removeAttribute(name) { delete sidebarAttributes[name]; },
  querySelector() { return firstSidebarLink; },
  contains(element) { return element === firstSidebarLink; },
  addEventListener(name, listener) { this.listeners[name] = listener; },
};
const media = { matches: true, addEventListener(_name, listener) { this.onChange = listener; } };
const selectSidebarElement = (selector) => selector === '#sidebar' ? sidebar : menu;
const setSidebarOpen = Function('$', 'mobileSidebarQuery', `${sidebarHelper}\nreturn setSidebarOpen;`)(selectSidebarElement, media);
const closeMobileSidebar = Function('$', 'mobileSidebarQuery', 'setSidebarOpen',
  `${closeSidebarHelper}\nreturn closeMobileSidebar;`)(selectSidebarElement, media, setSidebarOpen);
const documentListeners = {};
const initializeNavigation = Function('setActiveNavigation', 'setSidebarOpen', '$', '$$', 'document',
  'mobileSidebarQuery', 'handleRecipeModalTab', 'isRecipeModalOpen', 'closeMobileSidebar',
  `${navigation}\nreturn initializeNavigation;`)(
  () => true, setSidebarOpen, selectSidebarElement, () => [],
  { addEventListener(name, listener) { documentListeners[name] = listener; },
    get activeElement() { return documentState.activeElement; } }, media,
  () => false, () => false, closeMobileSidebar,
);
initializeNavigation();
assert.equal(sidebar.inert, true, 'Closed mobile sidebar must not receive keyboard focus');
assert.equal(sidebarAttributes['aria-hidden'], 'true');
assert.equal(menuAttributes['aria-expanded'], 'false');
menu.listeners.click();
assert.equal(sidebar.inert, false);
assert.equal(sidebar.open, true);
assert.equal(documentState.activeElement, firstSidebarLink, 'Opening moves focus into navigation');
documentListeners.keydown({ key: 'Escape' });
assert.equal(sidebar.inert, true);
assert.equal(documentState.activeElement, menu, 'Escape restores menu focus');
menu.listeners.click();
sidebar.listeners.focusout({ relatedTarget: {} });
assert.equal(sidebar.inert, true, 'Leaving an open drawer closes it');
menu.listeners.click();
documentListeners.click({ target: {} });
assert.equal(sidebar.inert, true, 'Clicking outside closes an open drawer');
menu.listeners.click();
sidebar.listeners.focusout({ relatedTarget: menu });
assert.equal(sidebar.open, true, 'Moving to the toggle does not close then reopen the drawer');
menu.listeners.click();
assert.equal(sidebar.inert, true, 'The toggle closes the drawer');
media.matches = false;
media.onChange({ matches: false });
assert.equal(sidebar.inert, false, 'Desktop navigation remains focusable');
assert.equal(sidebarAttributes['aria-hidden'], undefined);
documentState.activeElement = firstSidebarLink;
media.matches = true;
media.onChange({ matches: true });
assert.equal(sidebar.inert, true, 'Returning to mobile closes the drawer');
assert.equal(documentState.activeElement, menu, 'Breakpoint transition restores visible focus');

assert.doesNotMatch(app, /window\.scrollTo|history\.pushState|addEventListener\(['"](?:hashchange|popstate)/);
assert.match(app, /liveState\?\.status !== 'ready'/);

assert.doesNotMatch(app, /innerHTML\s*=|insertAdjacentHTML|document\.write/);
assert.doesNotMatch(app, /fetch\s*\(|XMLHttpRequest|WebSocket|signUp|signIn|exchangeCodeForSession/);

console.log('Offline favicon and responsive sidebar wiring tests passed.');
