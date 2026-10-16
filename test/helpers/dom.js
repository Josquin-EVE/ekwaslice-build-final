import { JSDOM } from 'jsdom';

// Globals posés pour que le code de src/ (navigateur) tourne sous node:test.
const GLOBALS = ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'MutationObserver', 'CustomEvent', 'Event'];

export function withDom(html = '<!doctype html><html><body></body></html>') {
  const dom = new JSDOM(html);
  const { window } = dom;
  const saved = new Map();
  for (const name of GLOBALS) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true, writable: true });
  }
  return {
    window,
    document: window.document,
    cleanup() {
      for (const name of GLOBALS) {
        const prev = saved.get(name);
        if (prev) Object.defineProperty(globalThis, name, prev);
        else delete globalThis[name];
      }
      window.close();
    },
  };
}
