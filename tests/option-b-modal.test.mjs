import assert from 'node:assert/strict';
import { createOptionBModal } from '../js/option-b-modal.js';
import { createRecipeLoginGate } from '../js/recipe-login-gate.js';

function fakeDocument() {
  const documentLike = { activeElement: null, body: { style: {} } };
  function element(tag) {
    const node = {
      tagName: tag.toUpperCase(), children: [], attributes: {}, listeners: {},
      className: '', textContent: '', hidden: false, isConnected: true,
      classList: { add(...names) { node.className += ` ${names.join(' ')}`; } },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, listener) { this.listeners[name] = listener; },
      removeEventListener(name) { delete this.listeners[name]; },
      focus() { documentLike.activeElement = this; },
      contains(target) { return this === target || this.children.some((child) => child.contains?.(target)); },
      querySelectorAll() { return []; },
    };
    return node;
  }
  const root = element('div');
  root.hidden = true;
  const panel = element('article');
  const closeButton = element('button');
  const content = element('div');
  root.querySelector = (selector) => selector === '.modal-panel' ? panel : closeButton;
  documentLike.createElement = element;
  documentLike.querySelector = (selector) => selector === '#recipe-modal' ? root
    : selector === '#modal-content' ? content : null;
  return { documentLike, root, content, closeButton };
}

const { documentLike, root, content } = fakeDocument();
const modal = createOptionBModal(documentLike);
const gate = createRecipeLoginGate({ documentLike, present: modal.present, dismiss: modal.close });
const trigger = documentLike.createElement('button');
assert.equal(gate.open({ recipe: {
  id: 'creamy-garlic-pasta', source: 'built-in', detailLevel: 'preview', name: '<Safe recipe>',
}, trigger }), true);
assert.equal(root.hidden, false);
const section = content.children[0];
assert.match(section.className, /option-b-login-gate/);
assert.equal(section.children[0].id, 'modal-title');
assert.equal(section.children[1].textContent.includes('<Safe recipe>'), true);
const [login, register, continueButton] = section.children[2].children;
assert.equal(login.attributes.href, 'login.html');
assert.equal(register.attributes.href, 'register.html');
assert.equal(login.textContent, 'Log In');
assert.equal(register.textContent, 'Create Account');
assert.equal(documentLike.activeElement, login);
continueButton.listeners.click();
assert.equal(root.hidden, true);
assert.equal(documentLike.activeElement, trigger);
assert.equal(gate.close(), false);
assert.equal(gate.open({ recipe: {
  id: 'creamy-garlic-pasta', source: 'built-in', detailLevel: 'preview', name: 'Safe recipe',
}, trigger }), true);
assert.equal(modal.close({ restoreFocus: true }), true);
assert.equal(documentLike.activeElement, trigger);
assert.equal(gate.close({ restoreFocus: false }), true,
  'Closing the rendered dialog must also clear the gate lifecycle');
assert.equal(gate.open({ recipe: {
  id: 'creamy-garlic-pasta', source: 'built-in', detailLevel: 'preview', name: 'Safe recipe',
}, trigger }), true);
gate.cleanup();
console.log('Candidate login dialog passed offline fake-DOM checks.');
