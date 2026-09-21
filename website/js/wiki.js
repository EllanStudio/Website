(() => {
  'use strict';
  const data = window.ELLAN_WIKI;
  const main = document.getElementById('wiki-content');
  if (!data || !main) return;
  const articles = new Map(data.articles.map(a => [a.id, a]));
  const categories = new Map(data.categories.map(c => [c.id, c]));
  const nav = document.getElementById('handbook-navigation');
  const input = document.getElementById('wiki-search');
  const clear = document.getElementById('wiki-search-clear');
  const sidebar = document.querySelector('.handbook-sidebar');
  const toggle = document.querySelector('.handbook-menu-toggle');
  const announcement = document.getElementById('wiki-announcement');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon = (name, cls = '') => `<i data-lucide="${esc(name)}" class="${esc(cls)}" aria-hidden="true"></i>`;
  const link = (id, label) => `<a href="#guide-${esc(id)}">${esc(label || articles.get(id)?.title)}${icon('arrow-right')}</a>`;
  const aliases = {'day-one':'guide-first-day','tutorial-directory':'category-all','guide-chestprotect':'guide-residence','guide-protection':'category-start','guide-music':'guide-community-tools','guide-planned':'guide-extraction'};
  let lastHash = null;
  let searchOrigin = '#home';
  let toastTimer;

  nav.innerHTML = `<a href="#home" data-nav="home">${icon('compass')}手册首页</a>` +
    data.categories.map(c => `<a href="#category-${c.id}" data-nav="${c.id}">${icon(c.icon)}${esc(c.title)}<small>${data.articles.filter(a => a.category === c.id).length}</small></a>`).join('') +
    `<a href="#commands" data-nav="commands">${icon('terminal')}常用命令</a><a href="#category-all" data-nav="all">${icon('library')}全部教程</a>`;

  function card(a) {
    return `<a class="topic-card" href="#guide-${esc(a.id)}"><img src="img/${esc(a.image)}" alt="" loading="lazy" width="480" height="260"><div class="topic-card-body"><small>${esc(a.tag)}</small><h3>${esc(a.title)}</h3><p>${esc(a.summary)}</p>${icon('arrow-up-right','card-arrow')}</div></a>`;
  }
  function heading(title, subtitle) {
    return `<header class="page-heading"><h1>${esc(title)}</h1><p>${esc(subtitle)}</p></header>`;
  }
  function home() {
    return `<section class="manual-section first-day-section" aria-labelledby="day-title"><div class="manual-section-heading"><h2 id="day-title">第一天，先做这三件事</h2><p>不用一次学会全部玩法</p></div>
      <div class="first-day-track"><a href="#guide-menu-travel"><b>01</b><span><strong>出发去生活</strong><small>找向导，去栖风谷或赤铁原</small></span></a><a href="#guide-residence"><b>02</b><span><strong>给自己一个家</strong><small>找落脚点，保护箱子和建筑</small></span></a><a href="#guide-market"><b>03</b><span><strong>赚到第一笔金币</strong><small>从小额收购与简单委托开始</small></span></a></div>
    </section>
    <div class="command-shortcuts"><span>先记住这几个</span><a href="#commands"><code>/cd</code> 打开菜单</a><a href="#commands"><code>/homelist</code> 找到自己的家</a><a href="#commands"><code>/balance</code> 查看金币</a><a href="#commands">全部命令 →</a></div>
    <section class="manual-section" aria-labelledby="play-title"><div class="manual-section-heading"><h2 id="play-title">今天，想做点什么？</h2><a href="#category-all">全部教程 →</a></div><div class="topic-grid">${data.featured.map(id => card(articles.get(id))).join('')}</div></section>
    <section class="manual-section" aria-labelledby="earn-title"><div class="manual-section-heading"><h2 id="earn-title">想赚钱？按手里的东西来选</h2><a href="#guide-currency">认识金币与声望 →</a></div>
      <div class="earning-routes">
        <a href="#guide-market">${icon('pickaxe')}<strong>有基础材料</strong><span>看系统收购 · 核对当前单价与限额</span>${icon('arrow-right')}</a>
        <a href="#guide-crop-shop">${icon('sprout')}<strong>有农作物或鱼获</strong><span>农产收购 / 钓鱼市场 · 留下自用与任务份额</span>${icon('arrow-right')}</a>
        <a href="#guide-food-shop">${icon('cooking-pot')}<strong>会做菜、会酿酒</strong><span>今日食品收购 / 限时订单 · 先看需求再生产</span>${icon('arrow-right')}</a>
        <a href="#guide-commissions">${icon('scroll-text')}<strong>还想积累声望</strong><span>每日与每周委托 · 从简单任务开始</span>${icon('arrow-right')}</a>
      </div>
    </section>
    <section class="coming-next"><div><span>下一段旅程 · 开发中</span><h2>十三钟：把生活，带向冒险</h2><p>种田、做饭、酿酒，未来也将成为探索远方的后勤。</p></div><a class="manual-link" href="#guide-extraction">看看未来的大陆 ${icon('arrow-up-right')}</a></section>`;
  }
  function directory(id) {
    const c = categories.get(id);
    const list = id === 'all' ? data.articles : data.articles.filter(a => a.category === id);
    return heading(c?.title || '全部教程', c?.intro || '找到你想做的事，从第一步开始。') + `<div class="topic-grid category-grid">${list.map(card).join('')}</div>`;
  }
  function commands(query = '') {
    const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const list = data.commands.filter(c => tokens.every(t => `${c.command} ${c.label} ${c.note}`.toLocaleLowerCase().includes(t)));
    const groups = [...new Set(list.map(c => c.group))];
    return groups.map(group => `<section class="command-group"><h2>${esc(group)}</h2>${list.filter(c=>c.group===group).map(c=>`<div class="command-row"><div><strong>${esc(c.label)}</strong><code>${esc(c.command)}</code><p>${esc(c.note)}</p></div><button type="button" class="icon-button" data-copy="${esc(c.command)}" title="复制 ${esc(c.command)}" aria-label="复制 ${esc(c.command)}">${icon('copy')}</button><a href="#guide-${c.related}" aria-label="${esc(c.label)}的相关教程">${icon('arrow-up-right')}</a></div>`).join('')}</section>`).join('');
  }
  function search(query) {
    const tokens = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const articleText = a => [a.title,a.keywords,a.summary,a.where,a.prepare,a.result,a.caution,...a.steps.flat(),...(a.details || []).flat()].join(' ').toLocaleLowerCase();
    const score = a => tokens.reduce((sum,t)=>sum + (a.title.includes(t)?100:0) + (a.keywords.includes(t)?40:0) + (a.summary.includes(t)?20:0),0);
    const list = data.articles.filter(a => tokens.every(t => articleText(a).includes(t))).sort((a,b)=>score(b)-score(a));
    const commandCount = data.commands.filter(c => tokens.every(t => `${c.command} ${c.label} ${c.note}`.toLocaleLowerCase().includes(t))).length;
    announcement.textContent = `找到 ${list.length} 篇教程、${commandCount} 条命令`;
    const commandResults = commands(query);
    return heading('寻找你的答案', query ? `“${query}” · ${list.length} 篇教程 / ${commandCount} 条命令` : '输入玩法、商店或你遇到的问题。') + commandResults +
      (list.length ? `<div class="topic-grid category-grid">${list.map(card).join('')}</div>` : commandCount ? '' : `<div class="empty-state">${icon('search-x')}<h2>还没找到这个答案</h2><p>试试“种地”“食品收购”或“提交不了”。</p><a class="manual-link" href="#guide-faq">去看看常见问题 ${icon('arrow-right')}</a></div>`);
  }
  function guide(a) {
    const c = categories.get(a.category);
    const extras = (a.details || []).map(([title, body]) => `<details class="guide-extra"><summary>${esc(title)}</summary><p>${esc(body)}</p></details>`).join('');
    const source = (a.sources || []).map(([title,url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>`).join(' · ');
    return `<div class="guide-topline"><a href="#category-${a.category}">${icon('arrow-left')}返回${esc(c.title)}</a><button class="icon-button" type="button" data-copy-link title="复制本篇链接" aria-label="复制本篇链接">${icon('link')}</button></div>
      <article><header class="guide-head"><p class="manual-eyebrow">${esc(a.tag)} / ${a.steps.length} 步上手</p><h1>${esc(a.title)}</h1><p>${esc(a.summary)}</p></header>
      <div class="guide-layout"><div class="guide-body"><dl class="guide-facts"><div><dt>去哪里</dt><dd>${esc(a.where)}</dd></div><div><dt>准备什么</dt><dd>${esc(a.prepare)}</dd></div><div><dt>完成后</dt><dd>${esc(a.result)}</dd></div></dl>
      <ol class="guide-step-list">${a.steps.map(([title,body])=>`<li><h2>${esc(title)}</h2><p>${esc(body)}</p></li>`).join('')}</ol>
      ${a.caution ? `<p class="guide-caution">${esc(a.caution)}</p>` : ''}
      ${a.helpTemplate ? `<section class="help-template"><h2>直接复制这份提问模板</h2><pre>${esc(a.helpTemplate)}</pre><button type="button" class="manual-link" data-copy="${esc(a.helpTemplate)}">${icon('copy')}复制提问模板</button></section>` : ''}${extras}
      ${source ? `<p class="guide-sources">机制参考：${source}。艾尔岚的物品要求与奖励以游戏内显示为准。</p>` : ''}</div>
      <aside class="guide-side" aria-label="操作演示与相关教程"><figure class="guide-scene"><img src="img/${esc(a.image)}" alt="${esc(a.title)}：艾尔岚实景" width="480" height="360"></figure>
      <figure class="demo-slot" id="guide-demo">${icon('clapperboard')}<strong>${esc(a.media.caption)}</strong><p>操作演示 · 待补充</p></figure>
      ${a.command ? `<div class="command-copy"><code>${esc(a.command)}</code><button class="icon-button" type="button" data-copy="${esc(a.command)}" title="复制命令" aria-label="复制命令 ${esc(a.command)}">${icon('copy')}</button></div>` : ''}
      <nav class="guide-next" aria-label="接下来可以做"><h2>接下来可以做</h2>${(a.related || []).map(id => link(id)).join('')}</nav></aside></div></article>`;
  }
  function media(a) {
    if (!a?.media?.src) return;
    const figure = document.getElementById('guide-demo');
    const fallback = [...figure.childNodes].map(node => node.cloneNode(true));
    const isVideo = /\.(mp4|webm)(\?|$)/i.test(a.media.src);
    const node = document.createElement(isVideo ? 'video' : 'img');
    const caption = document.createElement('figcaption');
    caption.textContent = a.media.caption;
    if (isVideo) { node.controls = true; node.preload = 'metadata'; node.playsInline = true; }
    else { node.alt = a.media.caption; node.decoding = 'async'; }
    node.addEventListener(isVideo ? 'loadedmetadata' : 'load', () => {
      // A slow download must never replace a different article after navigation.
      if (!figure.isConnected) return;
      figure.replaceChildren(node, caption);
      figure.classList.add('demo-loaded');
    }, {once:true});
    node.addEventListener('error', () => {
      if (!figure.isConnected) return;
      figure.replaceChildren(...fallback);
      figure.classList.remove('demo-loaded');
      figure.querySelector('p').textContent = '演示暂时无法加载，请先参考操作步骤。';
    }, {once:true});
    node.src = a.media.src;
  }
  function render({focus = false, keepScroll = false} = {}) {
    let hash = location.hash.slice(1) || 'home';
    hash = aliases[hash] || hash;
    if (hash.startsWith('guide-') && categories.has(hash.slice(6))) hash = `category-${hash.slice(6)}`;
    lastHash = location.hash;
    let current = 'home', title = '首页', a = null;
    if (hash.startsWith('search?')) {
      const query = new URLSearchParams(hash.slice(7)).get('q') || '';
      input.value = query;
      main.innerHTML = search(query);
      current = 'search'; title = '搜索';
    } else {
      input.value = '';
      if (hash === 'home') main.innerHTML = home();
      else if (hash === 'commands') {
        current = 'commands'; title = '常用命令';
        main.innerHTML = heading('这件事，用哪条命令？','复制后在游戏聊天框使用；玩家名、金额、家的名字需要换成自己的。') + '<p class="guide-caution">命令可用范围、冷却、费用与权限以当前游戏提示为准。这里不沿用旧手册中的固定数值。</p>' + commands();
      }
      else if (hash.startsWith('category-') && (hash === 'category-all' || categories.has(hash.slice(9)))) {
        current = hash.slice(9); title = categories.get(current)?.title || '全部教程'; main.innerHTML = directory(current);
      } else if (hash.startsWith('guide-') && articles.has(hash.slice(6))) {
        a = articles.get(hash.slice(6)); current = a.planned ? 'planned' : a.category; title = a.title; main.innerHTML = guide(a);
      } else {
        title = '未找到教程'; current = '';
        main.innerHTML = heading('这篇教程暂时找不到', '链接可能已经变化，回目录找找看。') + '<a class="manual-link" href="#home">返回手册首页 →</a>';
      }
      announcement.textContent = title;
    }
    clear.hidden = !input.value;
    document.body.dataset.wikiView = hash === 'home' ? 'home' : 'article';
    document.title = `${title === '首页' ? '新手旅行手册' : title + ' · 新手旅行手册'} · 艾尔岚`;
    document.getElementById('wiki-breadcrumb').textContent = `旅行手册 / ${title}`;
    nav.querySelectorAll('[data-nav]').forEach(el => { if(el.dataset.nav === current) el.setAttribute('aria-current','page'); else el.removeAttribute('aria-current'); });
    window.lucide?.createIcons();
    media(a);
    if (!keepScroll) window.scrollTo({top:0, behavior:'instant'});
    if (focus) main.focus({preventScroll:true});
  }
  function navigate(hash, options = {}) {
    history[options.replace ? 'replaceState' : 'pushState'](null,'',hash);
    render(options);
  }
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href^="#"]');
    if (!anchor || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const hash = anchor.getAttribute('href');
    if (hash === '#wiki-content') return;
    if (!/^(#home|#commands|#guide-|#category-|#search\?)/.test(hash)) return;
    event.preventDefault();
    sidebar.classList.remove('is-open'); toggle.setAttribute('aria-expanded','false');
    navigate(hash,{focus:true});
  }, true);
  const restore = () => { if (lastHash !== location.hash) render(); };
  window.addEventListener('popstate',restore);
  window.addEventListener('hashchange',restore);
  toggle.addEventListener('click', () => { const open = sidebar.classList.toggle('is-open'); toggle.setAttribute('aria-expanded', String(open)); });
  function performSearch() {
    if (!input.value.trim()) { navigate(searchOrigin, {replace:location.hash.startsWith('#search?'),keepScroll:true}); input.focus(); return; }
    const inSearch = location.hash.startsWith('#search?');
    if (!inSearch) searchOrigin = location.hash || '#home';
    const start = input.selectionStart, end = input.selectionEnd;
    navigate('#search?q=' + encodeURIComponent(input.value), {replace:inSearch,keepScroll:true});
    input.focus();
    // type=search supports selection ranges in the supported desktop browsers.
    try { input.setSelectionRange(start,end); } catch (_) { /* optional selection API */ }
  }
  input.addEventListener('input', event => { if (!event.isComposing) performSearch(); });
  input.addEventListener('compositionend',performSearch);
  document.getElementById('wiki-search-form').addEventListener('submit',event => { event.preventDefault(); performSearch(); });
  clear.addEventListener('click', () => { input.value = ''; performSearch(); });
  input.addEventListener('keydown', event => { if (event.key === 'Escape') { input.value = ''; performSearch(); } });
  async function copy(value) {
    const toast = document.getElementById('wiki-toast');
    let message;
    try { await navigator.clipboard.writeText(value); message = '已复制'; }
    catch (_) { message = `请手动复制：${value}`; }
    toast.textContent = message; toast.classList.add('visible'); clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>toast.classList.remove('visible'),4500);
  }
  main.addEventListener('click', event => { const button = event.target.closest('[data-copy],[data-copy-link]'); if (button) copy(button.hasAttribute('data-copy-link') ? location.href : button.dataset.copy); });
  render();
})();
