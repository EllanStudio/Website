/* 艾尔岚 · 服务器新闻页：读取 api/launcher-news.php 并渲染。
   所有文本都以 textContent 写入，链接只接受 https。 */
(function () {
	'use strict';

	var API = 'api/launcher-news.php';
	var listEl = document.getElementById('news-list');
	var emptyEl = document.getElementById('news-empty');
	var errorEl = document.getElementById('news-error');
	var filterEl = document.getElementById('news-filter');
	var updatedEl = document.getElementById('news-updated');
	var retryEl = document.getElementById('news-retry');
	if (!listEl || !filterEl) return;

	var items = [];
	var category = '全部';

	function safeUrl(value) {
		try {
			var u = new URL(value, location.href);
			return u.protocol === 'https:' ? u.href : '';
		} catch (e) {
			return '';
		}
	}

	function formatDate(iso) {
		var d = new Date(iso);
		if (isNaN(d.getTime())) return '';
		return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
	}

	function el(tag, className, text) {
		var node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function card(item, index, featured) {
		var href = safeUrl(item.link);
		var root = el(href ? 'a' : 'article', 'news-card' + (featured ? ' is-featured' : ''));
		root.style.setProperty('--i', String(Math.min(index, 12)));
		if (href) {
			root.href = href;
			root.target = '_blank';
			root.rel = 'noopener noreferrer';
		}
		var imageUrl = item.image ? safeUrl(item.image.url) : '';
		if (imageUrl) {
			var media = el('div', 'news-card-media');
			var img = document.createElement('img');
			img.src = imageUrl;
			img.alt = '';
			img.loading = 'lazy';
			img.decoding = 'async';
			img.referrerPolicy = 'no-referrer';
			img.addEventListener('error', function () { media.remove(); });
			media.appendChild(img);
			root.appendChild(media);
		}
		var body = el('div', 'news-card-body');
		var meta = el('div', 'news-card-meta');
		var tag = el('span', 'news-tag', item.category || '公告');
		tag.setAttribute('data-category', item.category || '公告');
		meta.appendChild(tag);
		meta.appendChild(el('time', 'news-date', formatDate(item.date)));
		body.appendChild(meta);
		body.appendChild(el('h3', '', item.title));
		if (item.summary) body.appendChild(el('p', '', item.summary));
		if (href) body.appendChild(el('span', 'news-card-more', '前往频道查看全文 →'));
		root.appendChild(body);
		return root;
	}

	function renderFilter() {
		var names = ['全部'];
		items.forEach(function (it) {
			var c = it.category || '公告';
			if (names.indexOf(c) === -1) names.push(c);
		});
		filterEl.textContent = '';
		filterEl.hidden = names.length < 3;
		names.forEach(function (name) {
			var b = el('button', '', name);
			b.type = 'button';
			b.setAttribute('aria-pressed', String(name === category));
			b.addEventListener('click', function () {
				category = name;
				renderFilter();
				renderList();
			});
			filterEl.appendChild(b);
		});
	}

	function renderList() {
		var shown = items.filter(function (it) { return category === '全部' || (it.category || '公告') === category; });
		listEl.textContent = '';
		listEl.setAttribute('aria-busy', 'false');
		emptyEl.hidden = shown.length > 0;
		shown.forEach(function (it, i) { listEl.appendChild(card(it, i, i === 0)); });
	}

	function skeleton() {
		listEl.textContent = '';
		listEl.setAttribute('aria-busy', 'true');
		for (var i = 0; i < 6; i++) listEl.appendChild(el('div', 'news-skeleton'));
	}

	function load() {
		errorEl.hidden = true;
		emptyEl.hidden = true;
		updatedEl.textContent = '读取中';
		skeleton();
		fetch(API, { headers: { Accept: 'application/json' } })
			.then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
			.then(function (data) {
				items = Array.isArray(data.items) ? data.items : [];
				category = '全部';
				renderFilter();
				renderList();
				var when = data.updated ? formatDate(data.updated) : '';
				updatedEl.textContent = items.length ? ('共 ' + items.length + ' 条' + (when ? ' · 同步于 ' + when : '')) : '';
			})
			.catch(function () {
				listEl.textContent = '';
				listEl.setAttribute('aria-busy', 'false');
				updatedEl.textContent = '';
				errorEl.hidden = false;
			});
	}

	if (retryEl) retryEl.addEventListener('click', load);
	load();
})();
