// 服务器状态查询(mcsrvstat.us API,彩色 MOTD 白名单消毒渲染)
(function () {
	'use strict';

	// 查询入口独立于玩家连接地址，使用迁移后的服务商域名跟随入口 IP 变化。
	var API_URL = 'https://api.mcsrvstat.us/3/t40.sjcmc.cn:14803';
	var REFRESH_MS = 60000;
	var TIMEOUT_MS = 10000;
	var MAX_HEADS = 10;
	var fetching = false;

	var icon = document.getElementById('server-icon');
	var motd = document.getElementById('server-motd');
	var version = document.getElementById('server-version');
	var players = document.getElementById('server-players');
	var ping = document.getElementById('server-ping');
	var strip = document.getElementById('player-strip');
	var navLive = document.getElementById('nav-live');
	var navLiveLabel = document.getElementById('nav-live-label');
	var heroOnline = document.getElementById('hero-online');

	if (!icon || !motd) return;

	/* 只保留文本、换行与 span 颜色/加粗,其余标签解包 */
	function appendSanitizedMotd(node, target) {
		Array.prototype.slice.call(node.childNodes).forEach(function (child) {
			if (child.nodeType === 3) {
				target.appendChild(document.createTextNode(child.nodeValue));
				return;
			}
			if (child.nodeType !== 1) return;
			var tag = child.tagName.toLowerCase();
			if (tag === 'br') {
				target.appendChild(document.createElement('br'));
				return;
			}
			if (tag === 'span') {
				var span = document.createElement('span');
				var color = child.style && child.style.color;
				if (color && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(color)) span.style.color = color;
				var weight = child.style && child.style.fontWeight;
				if (weight === 'bold' || parseInt(weight, 10) >= 600) span.style.fontWeight = '700';
				appendSanitizedMotd(child, span);
				target.appendChild(span);
				return;
			}
			appendSanitizedMotd(child, target);
		});
	}

	function renderMotd(data) {
		motd.textContent = '';
		if (data.motd && Array.isArray(data.motd.html) && data.motd.html.length) {
			var frag = document.createDocumentFragment();
			data.motd.html.forEach(function (line, index) {
				if (index > 0) frag.appendChild(document.createElement('br'));
				var doc = new DOMParser().parseFromString('<div>' + line + '</div>', 'text/html');
				var wrapper = doc.body.firstChild;
				if (wrapper) appendSanitizedMotd(wrapper, frag);
			});
			motd.appendChild(frag);
		} else if (data.motd && Array.isArray(data.motd.clean)) {
			motd.textContent = data.motd.clean.join('\n');
		} else {
			motd.textContent = '(无 MOTD)';
		}
	}

	function tweenPlayers(target, max) {
		var from = parseInt(players.getAttribute('data-count') || '0', 10) || 0;
		players.setAttribute('data-count', String(target));
		// QA 截图模式(?shot=1)下无头浏览器只会绘制极少的 rAF 帧,直接落终值
		if (from === target || document.documentElement.classList.contains('qa-shot')) {
			players.textContent = target + ' / ' + max;
			return;
		}
		var start = null;
		var duration = 500;
		function step(now) {
			if (!start) start = now;
			var p = Math.min((now - start) / duration, 1);
			var eased = 1 - Math.pow(1 - p, 3);
			players.textContent = Math.round(from + (target - from) * eased) + ' / ' + max;
			if (p < 1) requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
	}

	function renderHeads(list, online) {
		if (!strip) return;
		strip.textContent = '';
		if (!Array.isArray(list) || !list.length) {
			strip.hidden = true;
			return;
		}
		var label = document.createElement('span');
		label.className = 'player-strip-label';
		label.textContent = '在线 ' + online + ' 人';
		strip.appendChild(label);

		list.slice(0, MAX_HEADS).forEach(function (entry) {
			var name = typeof entry === 'string' ? entry : (entry && entry.name) || '';
			if (!name) return;
			var img = document.createElement('img');
			img.src = 'https://minotar.net/helm/' + encodeURIComponent(name) + '/44.png';
			img.alt = name;
			img.title = name;
			img.loading = 'lazy';
			img.onerror = function () { img.remove(); };
			strip.appendChild(img);
		});

		if (list.length > MAX_HEADS) {
			var more = document.createElement('span');
			more.className = 'player-strip-more';
			more.textContent = '+' + (list.length - MAX_HEADS);
			strip.appendChild(more);
		}
		strip.hidden = false;
	}

	function setNavLive(state, online) {
		if (heroOnline) {
			heroOnline.textContent = state === 'online'
				? (typeof online === 'number' ? online + ' 人在线' : '服务器在线')
				: (state === 'offline' ? '暂未连通' : '状态暂不可用');
		}
		if (!navLive || !navLiveLabel) return;
		navLive.classList.remove('is-online', 'is-offline');
		if (state === 'online') {
			navLive.classList.add('is-online');
			navLiveLabel.textContent = typeof online === 'number' ? online + ' 人在线' : '服务器在线';
		} else if (state === 'offline') {
			navLive.classList.add('is-offline');
			navLiveLabel.textContent = '暂未连通';
		} else {
			navLiveLabel.textContent = '状态暂不可用';
		}
	}

	function clearStatus() {
		players.textContent = '– / –';
		players.setAttribute('data-count', '0');
		if (ping) ping.textContent = '';
		if (strip) {
			strip.textContent = '';
			strip.hidden = true;
		}
		icon.src = 'img/icon.png';
	}

	async function fetchServerStatus() {
		if (document.hidden || fetching) return;
		fetching = true;
		var controller = new AbortController();
		var timeout = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
		var started = performance.now();
		try {
			var res = await fetch(API_URL, { signal: controller.signal });
			if (!res.ok) throw new Error('Status HTTP ' + res.status);
			var data = await res.json();
			if (!data || typeof data.online !== 'boolean') throw new Error('Invalid server status');
			var rtt = Math.round(performance.now() - started);

			if (data.online) {
				if (!data.players || !Number.isInteger(data.players.online) || data.players.online < 0) {
					throw new Error('Invalid player count');
				}
				renderMotd(data);
				version.textContent = 'JAVA ' + (data.version || '未知');
				var online = data.players.online;
				var max = data.players && data.players.max ? data.players.max : '–';
				tweenPlayers(online, max);
				if (ping) {
					// API 的 debug.ping 是布尔值，请求耗时不是玩家的游戏延迟。
					ping.textContent = '查询耗时 ' + rtt + 'ms';
				}
				renderHeads(data.players && data.players.list, online);
				icon.src = data.icon || 'img/icon.png';
				setNavLive('online', online);
			} else {
				clearStatus();
				motd.textContent = '状态查询节点暂未连通服务器，可在游戏内尝试连接';
				version.textContent = '';
				setNavLive('offline');
			}
		} catch (err) {
			clearStatus();
			motd.textContent = '状态获取失败,' + Math.round(REFRESH_MS / 1000) + ' 秒后自动重试';
			version.textContent = '';
			setNavLive('error');
		} finally {
			clearTimeout(timeout);
			fetching = false;
		}
	}

	fetchServerStatus();
	setInterval(fetchServerStatus, REFRESH_MS);
	document.addEventListener('visibilitychange', function () {
		if (!document.hidden) fetchServerStatus();
	});
})();
