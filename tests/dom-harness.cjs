'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function decode(text) {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, token => {
    const named = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
    if (named[token]) return named[token];
    return String.fromCodePoint(token[2].toLowerCase() === 'x' ? parseInt(token.slice(3), 16) : parseInt(token.slice(2), 10));
  });
}
class Node {
  constructor(tag, owner, text) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = owner; this.nodeType = tag === '#text' ? 3 : 1;
    this.childNodes = []; this.parentNode = null; this.attributes = {}; this.dataset = {}; this.style = {};
    this.listeners = {}; this._text = text || ''; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false;
    this.style.setProperty = (key, value) => { this.style[key] = value; };
    this.classList = {
      add: (...names) => { const set = new Set(this.className.split(/\s+/).filter(Boolean)); names.forEach(n => set.add(n)); this.className = [...set].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(n => !names.includes(n)).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => { const on = force === undefined ? !this.classList.contains(name) : force; on ? this.classList.add(name) : this.classList.remove(name); return on; }
    };
  }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get className() { return this.attributes.class || ''; }
  set className(value) { this.attributes.class = String(value); }
  get id() { return this.attributes.id || ''; }
  set id(value) { this.attributes.id = value; }
  get textContent() { return this._text + this.childNodes.map(n => n.textContent).join(''); }
  set textContent(value) { this.childNodes.forEach(n => { n.parentNode = null; }); this.childNodes = []; this._text = String(value); }
  set innerHTML(value) { this.textContent = ''; parseHTML(String(value), this); }
  get innerHTML() { return this.textContent; }
  appendChild(node) { if (node.parentNode) node.parentNode.removeChild(node); this._text = ''; this.childNodes.push(node); node.parentNode = this; return node; }
  append(...nodes) { nodes.forEach(n => this.appendChild(typeof n === 'string' ? this.ownerDocument.createTextNode(n) : n)); }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i < 0) throw new Error('Child not attached.'); this.childNodes.splice(i, 1); node.parentNode = null; return node; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    if (name === 'value') this.value = String(value);
    if (name === 'checked') this.checked = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'hidden') this.hidden = true;
    if (name === 'width' || name === 'height') this[name] = Number(value);
    if (name === 'type') this.type = String(value);
  }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  removeAttribute(name) { delete this.attributes[name]; }
  matches(selector) {
    const attrs = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']+)["']?)?\]/g)];
    if (!attrs.every(([, name, value]) => this.hasAttribute(name) && (value === undefined || this.getAttribute(name) === value))) return false;
    selector = selector.replace(/\[[^\]]+\]/g, '');
    const id = selector.match(/#([\w-]+)/); if (id && this.id !== id[1]) return false;
    const classes = [...selector.matchAll(/\.([\w-]+)/g)]; if (!classes.every(([, c]) => this.classList.contains(c))) return false;
    const tag = selector.match(/^[\w-]+/); return !tag || this.tagName.toLowerCase() === tag[0].toLowerCase();
  }
  querySelectorAll(selector) {
    const selectors = selector.split(',').map(s => s.trim()), results = [];
    const visit = node => { for (const child of node.children) { if (selectors.some(s => child.matches(s))) results.push(child); visit(child); } };
    visit(this); return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }
  removeEventListener(type, listener) { this.listeners[type] = (this.listeners[type] || []).filter(f => f !== listener); }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    event.preventDefault ||= function () { this.defaultPrevented = true; };
    event.stopPropagation ||= function () { this.stopped = true; };
    for (const listener of this.listeners[event.type] || []) listener.call(this, event);
    if (event.bubbles && !event.stopped && this.parentNode) this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }
  click() {
    if (this.disabled) return;
    if (this.tagName === 'A' && this.download) this.ownerDocument.downloads.push({ name: this.download, url: this.href });
    this.dispatchEvent({ type: 'click', bubbles: true });
  }
  focus() { this.ownerDocument.activeElement = this; this.dispatchEvent({ type: 'focus' }); }
  setPointerCapture() {}
  getBoundingClientRect() {
    const view = (this.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const width = this._rect?.width || (view.length === 4 ? view[2] : (this.tagName === 'CANVAS' ? 640 : this.width || 760));
    const height = this._rect?.height || (view.length === 4 ? view[3] : (this.tagName === 'CANVAS' ? 320 : this.height || 420));
    const left = this._rect?.left || 0, top = this._rect?.top || 0;
    return { width, height, left, top, right: left + width, bottom: top + height };
  }
  getContext() {
    if (this.context) return this.context;
    const calls = [], context = { calls, imageSmoothingEnabled: true };
    for (const method of ['fillRect', 'clearRect', 'beginPath', 'rect', 'fill', 'stroke', 'moveTo', 'lineTo', 'arc', 'ellipse', 'save', 'restore', 'setTransform', 'scale', 'translate', 'closePath', 'fillText', 'strokeRect', 'setLineDash', 'drawImage']) {
      context[method] = (...args) => { if (args.some(v => typeof v === 'number' && !Number.isFinite(v))) throw new Error('Non finite canvas coordinate.'); calls.push({ method, args }); };
    }
    context.measureText = text => ({ width: String(text).length * 7 });
    this.context = context; return context;
  }
}
function parseHTML(source, parent) {
  const stack = [parent], tokens = source.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g) || [];
  const voids = new Set(['meta', 'link', 'input', 'br', 'hr', 'img', 'source']);
  for (const token of tokens) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
    if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1]; if (!tag) continue;
      const node = parent.ownerDocument.createElement(tag);
      const attrs = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
      for (const [, name, a, b, c] of attrs.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(name, decode(a ?? b ?? c ?? ''));
      stack[stack.length - 1].appendChild(node);
      if (!voids.has(tag) && !token.endsWith('/>')) stack.push(node);
    } else if (token) stack[stack.length - 1].appendChild(parent.ownerDocument.createTextNode(decode(token)));
  }
}
function boot(repo, scripts, options = {}) {
  const document = new Node('#document', null); document.ownerDocument = document; document.downloads = [];
  document.createElement = tag => new Node(tag, document);
  document.createElementNS = (_, tag) => document.createElement(tag);
  document.createTextNode = text => new Node('#text', document, text);
  document.getElementById = id => document.querySelector('#' + id);
  parseHTML(fs.readFileSync(path.join(repo, 'index.html'), 'utf8'), document);
  document.documentElement = document.querySelector('html'); document.body = document.querySelector('body');
  let now = 0, serial = 0; const rafs = new Map(), timers = new Map(), storage = new Map(), blobs = new Map(), errors = [], observers = [];
  const sandbox = {
    document, Blob, Uint8Array, Uint16Array, Float64Array, TextEncoder, TextDecoder, URL: {
      createObjectURL: blob => { const id = 'blob:test-' + ++serial; blobs.set(id, blob); return id; }, revokeObjectURL: id => blobs.delete(id)
    },
    console: { log() {}, warn() {}, error: (...args) => errors.push(args.join(' ')) },
    performance: { now: () => now }, devicePixelRatio: options.dpr || 1,
    localStorage: { getItem: key => { if (options.blockStorage) throw new Error('Storage blocked'); return storage.get(key) || null; }, setItem: (key, value) => { if (options.blockStorage) throw new Error('Storage blocked'); storage.set(key, value); } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    matchMedia: () => ({ matches: !!options.reduceMotion, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: callback => { const id = ++serial; rafs.set(id, callback); return id; }, cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: (callback, delay = 0) => { const id = ++serial; timers.set(id, { callback, next: now + delay, interval: 0 }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: (callback, interval) => { const id = ++serial; timers.set(id, { callback, next: now + interval, interval }); return id; }, clearInterval: id => timers.delete(id),
    ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} },
    AudioContext: options.AudioContext
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  const windowEvents = new Node('#window', document);
  sandbox.addEventListener = windowEvents.addEventListener.bind(windowEvents); sandbox.removeEventListener = windowEvents.removeEventListener.bind(windowEvents);
  vm.createContext(sandbox);
  for (const script of scripts) vm.runInContext(fs.readFileSync(path.join(repo, script), 'utf8'), sandbox, { filename: script });
  function event(node, type, properties = {}) { const e = { type, bubbles: true, ...properties }; node.dispatchEvent(e); return e; }
  function frame(delta = 1000 / 60) {
    now += delta;
    for (const [id, timer] of [...timers]) if (timer.next <= now) { if (timer.interval) timer.next += timer.interval; else timers.delete(id); timer.callback(); }
    const callbacks = [...rafs.values()]; rafs.clear(); callbacks.forEach(callback => callback(now));
  }
  return { document, sandbox, event, frame, windowEvents, blobs, errors, observers, rafs, timers, node: id => document.getElementById(id) };
}
module.exports = { boot };
