import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../website/js/server-status.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

function element() {
  const attributes = new Map();
  const classes = new Set();
  return {
    textContent: '', hidden: false, children: [],
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name)
    },
    getAttribute: name => attributes.get(name),
    setAttribute: (name, value) => attributes.set(name, value),
    appendChild(child) { this.children.push(child); }
  };
}

function harness(responder, navOnly = false) {
  const elements = new Map();
  const calls = [];
  const events = {};
  const timers = new Map();
  let timerId = 0;
  let refresh;
  const document = {
    hidden: false,
    documentElement: { classList: { contains: () => true } },
    getElementById(id) {
      if (navOnly && !['nav-live', 'nav-live-label'].includes(id)) return null;
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
    addEventListener(name, callback) { events[name] = callback; }
  };
  vm.runInNewContext(source, {
    document, AbortController,
    performance: { now: () => calls.length * 240 },
    fetch(url, options) {
      calls.push({ url, options });
      return responder(url, options);
    },
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { refresh = callback; }
  });
  return { elements, calls, events, timers, document, refresh: () => refresh() };
}

const online = {
  online: true, version: '26.2', players: { online: 21, max: 50, list: ['Tester'] },
  motd: { clean: ['Ellan'] }, debug: { ping: true }
};
const response = (data, status = 200) => Promise.resolve({
  ok: status >= 200 && status < 300, status, json: async () => data
});

test('handbook header works without homepage status card on online, offline and error states', async () => {
  for (const [data, status, expected] of [[online, 200, '21 人在线'], [{online:false}, 200, '暂未连通'], [{}, 503, '状态暂不可用']]) {
    const app = harness(() => response(data, status), true);
    await settle();
    assert.equal(app.elements.get('nav-live-label').textContent, expected);
    assert.equal(app.calls.length, 1);
  }
});

test('queries the migrated entry and does not render a boolean ping as 1ms', async () => {
  const app = harness(() => response(online));
  await settle();
  assert.equal(app.calls[0].url, 'https://api.mcsrvstat.us/3/t40.sjcmc.cn:14803');
  assert.equal(app.elements.get('server-players').textContent, '21 / 50');
  assert.equal(app.elements.get('hero-online').textContent, '21 人在线');
  assert.equal(app.elements.get('server-ping').textContent, '查询耗时 240ms');
  assert.equal(app.timers.size, 0);
});

test('an unreachable probe is not presented as a confirmed server shutdown', async () => {
  const app = harness(() => response({ online: false }));
  await settle();
  assert.equal(app.elements.get('hero-online').textContent, '暂未连通');
  assert.match(app.elements.get('server-motd').textContent, /游戏内尝试连接/);
  assert.equal(app.elements.get('player-strip').hidden, true);
});

for (const [label, data, status] of [
  ['HTTP error', online, 503],
  ['missing online field', {}, 200],
  ['invalid player count', { online: true, players: { online: -1 } }, 200]
]) {
  test(`${label} clears stale online state and recovers on the next refresh`, async () => {
    let failing = false;
    const app = harness(() => response(failing ? data : online, failing ? status : 200));
    await settle();
    failing = true;
    await app.refresh();
    assert.equal(app.elements.get('hero-online').textContent, '状态暂不可用');
    assert.equal(app.elements.get('server-players').textContent, '– / –');
    assert.equal(app.elements.get('player-strip').hidden, true);
    assert.equal(app.elements.get('server-ping').textContent, '');
    failing = false;
    await app.refresh();
    assert.equal(app.elements.get('hero-online').textContent, '21 人在线');
  });
}

test('timeouts abort requests, prevent overlap, and allow retry', async () => {
  let pending = true;
  const app = harness((url, { signal }) => pending
    ? new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    : response(online));
  await app.refresh();
  app.events.visibilitychange();
  assert.equal(app.calls.length, 1);
  [...app.timers.values()][0]();
  await settle();
  assert.equal(app.elements.get('hero-online').textContent, '状态暂不可用');
  assert.equal(app.calls[0].options.signal.aborted, true);
  pending = false;
  await app.refresh();
  assert.equal(app.calls.length, 2);
  assert.equal(app.elements.get('hero-online').textContent, '21 人在线');
  app.document.hidden = true;
  await app.refresh();
  assert.equal(app.calls.length, 2);
});
