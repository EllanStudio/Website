import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = new URL('../website/', import.meta.url);
const context = { window: {} };
vm.runInNewContext(readFileSync(new URL('js/wiki-data.js', root), 'utf8'), context);
const data = context.window.ELLAN_WIKI;
const ids = new Set(data.articles.map(a => a.id));

test('every tutorial has a unique route, category and concise actionable steps', () => {
  assert.equal(ids.size, data.articles.length);
  const categories = new Set(data.categories.map(c=>c.id));
  for (const a of data.articles) {
    assert.match(a.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(categories.has(a.category), a.id);
    for (const key of ['title','summary','where','prepare','result','keywords']) assert.ok(a[key], `${a.id}: ${key}`);
    assert.ok(a.steps.length >= 1, a.id);
    for (const step of a.steps) assert.equal(step.length,2);
    for (const id of a.related || []) assert.ok(ids.has(id), `${a.id} -> ${id}`);
  }
});
test('all scene images exist; media placeholders never request imaginary assets', () => {
  for (const a of data.articles) {
    assert.ok(existsSync(new URL(`img/${a.image}`, root)), a.image);
    assert.ok(a.media.caption, a.id);
    if (a.media.src) {
      assert.match(a.media.src, /^img\/[a-z0-9/_-]+\.(webp|png|jpg|gif|mp4|webm)$/i);
      assert.ok(existsSync(fileURLToPath(new URL(a.media.src,root))), a.media.src);
    }
  }
});
test('home entries and command links resolve; no administrative commands published', () => {
  for (const id of data.featured) assert.ok(ids.has(id), id);
  assert.equal(new Set(data.commands.map(c=>c.command)).size, data.commands.length);
  for (const c of data.commands) {
    assert.ok(ids.has(c.related),c.command);
    assert.match(c.command, /^\//);
    assert.doesNotMatch(c.command, /reload|force-tick|debug|\bop\b|stop/);
  }
});
test('old handbook version limits and stale features are not republished', () => {
  const text = JSON.stringify(data);
  for (const stale of ['Java17','Java21','AllMusic_Client','冷却CD为30秒','0.4元/格','回忆药水']) assert.ok(!text.includes(stale), stale);
  assert.equal(data.articles.find(a=>a.id==='extraction').planned, true);
});

test('support has help, fair-play rules and the corrected Java requirement', () => {
  const help = data.articles.find(a => a.id === 'asking-for-help');
  const rules = data.articles.find(a => a.id === 'server-rules');
  assert.equal(help.category, 'support');
  assert.equal(rules.category, 'support');
  assert.match(help.helpTemplate, /发生时间/);
  assert.match(JSON.stringify(rules), /申诉/);
  assert.match(JSON.stringify(data.articles.find(a => a.id === 'first-login')), /26\.2.*Java 25/);
  assert.doesNotMatch(JSON.stringify(data), /玻璃.*爆炸|活版门.*爆炸|Java\s*(17|21)/);
  assert.doesNotMatch(readFileSync(new URL('js/wiki.js', root),'utf8'), /官网场景配图 · 下方预留操作演示/);
});

test('handbook navigation matches the homepage links and order', () => {
  const links = file => {
    const html = readFileSync(new URL(file,root),'utf8');
    const nav = html.match(/<div class="nav-links">([\s\S]*?)<\/div>/)[1];
    return [...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([,href,label])=>[href.replace(/^index\.html/,''),label]);
  };
  assert.deepEqual(links('wiki.html'),links('index.html'));
  assert.ok(links('index.html').some(([,label])=>label === '新手旅行手册'));
});
