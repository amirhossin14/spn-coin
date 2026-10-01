/**
 * Minimal jest-style expect() shim built on node:assert.
 * Lets jest-authored tests run under Node's built-in test runner
 * with no external dependencies.
 */
'use strict';
const assert = require('node:assert');

function makeExpect(received, negated = false) {
  const check = (pass, msg) => {
    if (negated) pass = !pass;
    assert.ok(pass, msg);
  };
  const api = {
    toBe(expected) { check(Object.is(received, expected), `expected ${received} ${negated ? 'not ' : ''}to be ${expected}`); },
    toEqual(expected) { check(deepEqual(received, expected), `expected deep equality`); },
    toBeTruthy() { check(!!received, `expected ${received} to be truthy`); },
    toBeFalsy() { check(!received, `expected ${received} to be falsy`); },
    toBeNull() { check(received === null, `expected ${received} to be null`); },
    toBeUndefined() { check(received === undefined, `expected ${received} to be undefined`); },
    toBeDefined() { check(received !== undefined, `expected value to be defined`); },
    toBeGreaterThan(n) { check(received > n, `expected ${received} > ${n}`); },
    toBeGreaterThanOrEqual(n) { check(received >= n, `expected ${received} >= ${n}`); },
    toBeLessThan(n) { check(received < n, `expected ${received} < ${n}`); },
    toBeLessThanOrEqual(n) { check(received <= n, `expected ${received} <= ${n}`); },
    toContain(item) {
      const ok = typeof received === 'string' ? received.includes(item) : Array.isArray(received) && received.includes(item);
      check(ok, `expected ${JSON.stringify(received)} to contain ${JSON.stringify(item)}`);
    },
    toMatch(re) { check(new RegExp(re).test(received), `expected ${received} to match ${re}`); },
    toHaveProperty(key) { check(received != null && Object.prototype.hasOwnProperty.call(received, key), `expected property ${key}`); },
    toHaveLength(n) { check(received != null && received.length === n, `expected length ${n}, got ${received && received.length}`); },
    toBeCloseTo(n, digits = 2) {
      const diff = Math.abs(received - n);
      check(diff < Math.pow(10, -digits) / 2, `expected ${received} close to ${n}`);
    },
    toBeInstanceOf(cls) { check(received instanceof cls, `expected instance of ${cls.name}`); },
    toThrow(expected) {
      let threw = false, err;
      try { received(); } catch (e) { threw = true; err = e; }
      if (expected && threw) check(String(err.message || err).includes(expected), `expected throw containing "${expected}", got "${err && err.message}"`);
      else check(threw, `expected function to throw`);
    },
  };
  // async matchers
  api.resolves = new Proxy({}, { get: () => async (expected) => {
    const val = await received;
    return makeExpect(val, negated).toBe(expected);
  }});
  api.rejects = {
    toThrow: async (expected) => {
      let threw = false, err;
      try { await received; } catch (e) { threw = true; err = e; }
      if (expected && threw) check(String(err.message || err).includes(expected), `expected rejection containing "${expected}"`);
      else check(threw, `expected promise to reject`);
    },
  };
  Object.defineProperty(api, 'not', { get: () => makeExpect(received, !negated) });
  return api;
}

function deepEqual(a, b) {
  try { assert.deepStrictEqual(a, b); return true; } catch { return false; }
}

function expect(received) { return makeExpect(received); }

// Install globally so test files can call expect() without importing.
global.expect = expect;
module.exports = expect;
