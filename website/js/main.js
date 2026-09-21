// Ellan 艾尔岚 · 主交互脚本(原生 JS,无依赖)
(function () {
	'use strict';

	var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/* ===== 首页 ↔ 玩法百科跨页过渡 ===== */
	var pageRoot = document.documentElement;
	var pageTransitionKey = 'ellan:page-transition-target';
	var supportsNativePageTransition = 'onpageswap' in window && 'onpagereveal' in window;

	function clearTransitionTarget() {
		try { sessionStorage.removeItem(pageTransitionKey); } catch (e) { /* storage may be unavailable */ }
	}

	function revealArrivingPage() {
		if (!pageRoot.classList.contains('page-arriving')) return;
		clearTransitionTarget();
		requestAnimationFrame(function () {
			requestAnimationFrame(function () {
				pageRoot.classList.add('page-arrived');
				setTimeout(function () {
					pageRoot.classList.remove('page-arriving', 'page-arrived');
				}, 380);
			});
		});
	}

	function pageKind(pathname) {
		if (/\/gameplay\.html$/i.test(pathname)) return 'gameplay';
		if (/\/wiki\.html$/i.test(pathname)) return 'wiki';
		if (/\/plan\.html$/i.test(pathname)) return 'plan';
		if (/\/thirteen-bells\.html$/i.test(pathname)) return 'thirteen-bells';
		if (/\/(?:index\.html)?$/i.test(pathname)) return 'home';
		return '';
	}

	if (!reduceMotion && !supportsNativePageTransition) {
		revealArrivingPage();

		document.addEventListener('click', function (event) {
			if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			var link = event.target.closest && event.target.closest('a[href]');
			if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

			var target;
			try { target = new URL(link.href, window.location.href); } catch (e) { return; }
			if (target.origin !== window.location.origin) return;

			var currentKind = pageKind(window.location.pathname);
			var targetKind = pageKind(target.pathname);
			if (!currentKind || !targetKind || currentKind === targetKind) return;

			event.preventDefault();
			if (pageRoot.classList.contains('page-leaving')) return;
			pageRoot.classList.add('page-leaving');
			try { sessionStorage.setItem(pageTransitionKey, target.pathname); } catch (e) { /* storage may be unavailable */ }
			setTimeout(function () { window.location.assign(target.href); }, 190);
		});

		window.addEventListener('pageshow', function (event) {
			if (!event.persisted || !pageRoot.classList.contains('page-leaving')) return;
			pageRoot.classList.remove('page-leaving');
			pageRoot.classList.add('page-arriving');
			revealArrivingPage();
		});
	}

	/* ===== 同页锚点平滑滚动；跨页面锚点保持即时落位 ===== */
	document.addEventListener('click', function (event) {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		var link = event.target.closest && event.target.closest('a[href]');
		if (!link || link.classList.contains('skip-link') || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

		var target;
		try { target = new URL(link.href, window.location.href); } catch (e) { return; }
		if (target.origin !== window.location.origin || target.pathname !== window.location.pathname || target.search !== window.location.search || !target.hash) return;

		var targetId;
		try { targetId = decodeURIComponent(target.hash.slice(1)); } catch (e) { return; }
		var section = document.getElementById(targetId);
		if (!section) return;

		event.preventDefault();
		if (window.location.hash !== target.hash) history.pushState(null, '', target.hash);
		section.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
	});

	/* ===== 导航栏滚动态 ===== */
	var header = document.getElementById('site-header');
	function onScroll() {
		header.classList.toggle('scrolled', window.scrollY > 24);
	}
	onScroll();
	window.addEventListener('scroll', onScroll, { passive: true });

	/* ===== 滚动渐入 ===== */
	/* QA 截图钩子:?shot=1 时全部立即可见并关闭平滑滚动 */
	var forceReveal = new URLSearchParams(window.location.search).get('shot') === '1';
	if (forceReveal) {
		document.documentElement.style.scrollBehavior = 'auto';
		document.documentElement.classList.add('qa-shot');
	}
	var revealEls = document.querySelectorAll('.reveal');
	if (forceReveal || reduceMotion || !('IntersectionObserver' in window)) {
		revealEls.forEach(function (el) { el.classList.add('visible'); });
	} else {
		var revealIo = new IntersectionObserver(function (entries) {
			entries.forEach(function (entry) {
				if (entry.isIntersecting) {
					entry.target.classList.add('visible');
					revealIo.unobserve(entry.target);
				}
			});
		}, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
		revealEls.forEach(function (el) { revealIo.observe(el); });
	}

	/* ===== 首屏主视觉视差 ===== */
	/* 移动端(窄屏)禁用视差:头图跟随滚动会持续重绘大图,导致下滑卡顿 */
	var heroArt = document.getElementById('hero-art-img');
	var hero = document.querySelector('.hero');
	var parallaxTicking = false;
	var parallaxEnabled = !reduceMotion && window.matchMedia('(min-width: 768px)').matches;
	function updateParallax() {
		parallaxTicking = false;
		if (!heroArt || !hero) return;
		var y = window.scrollY;
		if (y > hero.offsetHeight) return;
		heroArt.style.transform = 'translate3d(0,' + (y * 0.32).toFixed(1) + 'px,0) scale(1.02)';
	}
	if (parallaxEnabled && heroArt) {
		window.addEventListener('scroll', function () {
			if (parallaxTicking) return;
			parallaxTicking = true;
			requestAnimationFrame(updateParallax);
		}, { passive: true });
	}

	/* ===== 导航当前区块高亮 ===== */
	var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-link'));
	function getNavSectionId(link) {
		var mappedSection = link.getAttribute('data-scroll-section');
		if (mappedSection) return mappedSection;
		var href = link.getAttribute('href') || '';
		return href.charAt(0) === '#' ? href.slice(1) : '';
	}
	function setActiveLink(id) {
		navLinks.forEach(function (link) {
			var active = getNavSectionId(link) === id;
			link.classList.toggle('active', active);
			if (active) link.setAttribute('aria-current', 'location');
			else link.removeAttribute('aria-current');
		});
	}
	var scrollSpyTicking = false;
	function updateActiveFromScroll() {
		var marker = window.scrollY + header.offsetHeight + window.innerHeight * 0.3;
		var activeId = 'top';
		navLinks.forEach(function (link) {
			var id = getNavSectionId(link);
			if (!id) return;
			var section = document.getElementById(id);
			if (section && section.offsetTop <= marker) activeId = id;
		});
		setActiveLink(activeId);
		scrollSpyTicking = false;
	}
	function requestScrollSpyUpdate() {
		if (scrollSpyTicking) return;
		scrollSpyTicking = true;
		requestAnimationFrame(updateActiveFromScroll);
	}
	var fixedNavSection = document.body.getAttribute('data-fixed-nav-section');
	if (fixedNavSection) {
		setActiveLink(fixedNavSection);
	} else {
		var initialSection = window.location.hash ? window.location.hash.slice(1) : 'top';
		if (document.getElementById(initialSection)) setActiveLink(initialSection);
		else updateActiveFromScroll();
		requestAnimationFrame(updateActiveFromScroll);
		window.addEventListener('scroll', requestScrollSpyUpdate, { passive: true });
		window.addEventListener('resize', requestScrollSpyUpdate);
	}

	/* ===== Toast 轻提示 ===== */
	window.showToast = function (message) {
		var root = document.getElementById('toast-root');
		if (!root) return;
		var toast = document.createElement('div');
		toast.className = 'toast';
		toast.textContent = message;
		root.appendChild(toast);
		requestAnimationFrame(function () {
			requestAnimationFrame(function () { toast.classList.add('show'); });
		});
		setTimeout(function () {
			toast.classList.remove('show');
			setTimeout(function () { toast.remove(); }, 350);
		}, 2600);
	};

	/* ===== 复制到剪贴板(含降级方案) ===== */
	function copyText(text, onOk, onFail) {
		function fallbackCopy() {
			var ta = document.createElement('textarea');
			ta.value = text;
			ta.style.position = 'fixed';
			ta.style.opacity = '0';
			ta.setAttribute('readonly', '');
			document.body.appendChild(ta);
			ta.focus();
			ta.select();
			try {
				document.execCommand('copy') ? onOk() : onFail();
			} catch (e) {
				onFail();
			}
			ta.remove();
			var selection = window.getSelection && window.getSelection();
			if (selection) selection.removeAllRanges();
		}
		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(text).then(onOk, fallbackCopy);
		} else {
			fallbackCopy();
		}
	}

	/* ===== 复制服务器 IP ===== */
	window.copyServerIP = function () {
		var ip = 'ellan.top';
		copyText(ip, function () {
			window.showToast('服务器 IP 已复制:' + ip);
		}, function () {
			window.showToast('复制失败,请手动输入:' + ip);
		});
	};

	/* ===== 下载客户端模态框 ===== */
	var modal = document.getElementById('client-download-popup');
	window.showDownloadOptions = function () {
		modal.hidden = false;
		document.body.style.overflow = 'hidden';
	};
	window.closePopup = function () {
		modal.hidden = true;
		document.body.style.overflow = '';
	};
	document.addEventListener('keydown', function (e) {
		if (e.key === 'Escape' && modal && !modal.hidden) window.closePopup();
	});

	/* ===== 扫码加群弹出层 ===== */
	var qrToggle = document.getElementById('qr-toggle');
	var qrPopover = document.getElementById('qr-popover');
	if (qrToggle && qrPopover) {
		var setQrOpen = function (open) {
			qrToggle.setAttribute('aria-expanded', String(open));
			if (open) {
				qrPopover.hidden = false;
				requestAnimationFrame(function () { qrPopover.classList.add('is-open'); });
			} else {
				qrPopover.classList.remove('is-open');
				setTimeout(function () {
					if (!qrPopover.classList.contains('is-open')) qrPopover.hidden = true;
				}, 260);
			}
		};
		qrToggle.addEventListener('click', function (e) {
			e.stopPropagation();
			setQrOpen(qrPopover.hidden);
		});
		qrPopover.addEventListener('click', function (e) { e.stopPropagation(); });
		document.addEventListener('click', function () {
			if (!qrPopover.hidden) setQrOpen(false);
		});
		document.addEventListener('keydown', function (e) {
			if (e.key === 'Escape' && !qrPopover.hidden) {
				setQrOpen(false);
				qrToggle.focus();
			}
		});
		/* QA 截图钩子:?qr=1 直接展开 */
		if (new URLSearchParams(window.location.search).get('qr') === '1') {
			qrPopover.hidden = false;
			qrPopover.classList.add('is-open');
			qrToggle.setAttribute('aria-expanded', 'true');
		}
	}

	/* ===== 收藏本站提示 ===== */
	/*
	 * Real edge refraction for Chromium: a procedural capsule displacement map
	 * drives an SVG backdrop filter. Technique reference:
	 * github.com/archisvaze/liquid-glass (used with author permission confirmed
	 * by the site owner; adapted only for the two button sizes).
	 */
	var glassButtons = document.querySelectorAll('.btn-glass');
	var isChromium = /\b(?:Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent);
	var glassSvgNS = 'http://www.w3.org/2000/svg';
	var glassDefs = null;

	function createGlassDefs() {
		if (glassDefs) return glassDefs;
		var svg = document.createElementNS(glassSvgNS, 'svg');
		svg.setAttribute('width', '0');
		svg.setAttribute('height', '0');
		svg.setAttribute('aria-hidden', 'true');
		svg.style.position = 'absolute';
		svg.style.overflow = 'hidden';
		glassDefs = document.createElementNS(glassSvgNS, 'defs');
		svg.appendChild(glassDefs);
		document.body.appendChild(svg);
		return glassDefs;
	}

	function glassSurface(position) {
		var x = Math.max(0, Math.min(1, position));
		return Math.pow(1 - Math.pow(1 - x, 4), 0.25);
	}

	function makeRefractionProfile(thickness, bezel, refractiveIndex, samples) {
		var profile = new Float64Array(samples);
		var eta = 1 / refractiveIndex;
		for (var i = 0; i < samples; i += 1) {
			var x = i / (samples - 1);
			var surfaceHeight = glassSurface(x);
			var delta = x < 1 ? 0.0001 : -0.0001;
			var slope = (glassSurface(x + delta) - surfaceHeight) / delta;
			var normalLength = Math.sqrt(slope * slope + 1);
			var normalX = -slope / normalLength;
			var normalY = -1 / normalLength;
			var discriminant = 1 - eta * eta * (1 - normalY * normalY);
			if (discriminant < 0) continue;
			var factor = eta * normalY + Math.sqrt(discriminant);
			var rayX = -factor * normalX;
			var rayY = eta - factor * normalY;
			if (Math.abs(rayY) > 0.00001) {
				profile[i] = rayX * ((surfaceHeight * bezel + thickness) / rayY);
			}
		}
		return profile;
	}

	function makeCapsuleDisplacement(width, height, radius, bezel, profile, maxDisplacement) {
		var canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		var context = canvas.getContext('2d');
		var image = context.createImageData(width, height);
		var pixels = image.data;
		var innerRadiusSquared = Math.pow(Math.max(radius - bezel, 0), 2);
		var radiusSquared = radius * radius;
		var outerRadiusSquared = Math.pow(radius + 1, 2);
		var straightWidth = width - radius * 2;
		var straightHeight = height - radius * 2;

		for (var y = 0; y < height; y += 1) {
			for (var x = 0; x < width; x += 1) {
				var index = (y * width + x) * 4;
				pixels[index] = 128;
				pixels[index + 1] = 128;
				pixels[index + 2] = 0;
				pixels[index + 3] = 255;

				var edgeX = x < radius ? x - radius : x >= width - radius ? x - radius - straightWidth : 0;
				var edgeY = y < radius ? y - radius : y >= height - radius ? y - radius - straightHeight : 0;
				var distanceSquared = edgeX * edgeX + edgeY * edgeY;
				if (distanceSquared > outerRadiusSquared || distanceSquared < innerRadiusSquared) continue;
				var distance = Math.sqrt(distanceSquared);
				if (distance === 0) continue;
				var depth = radius - distance;
				var opacity = distanceSquared < radiusSquared ? 1 : Math.max(0, 1 - (distance - radius));
				var sample = Math.max(0, Math.min(profile.length - 1, Math.floor((depth / bezel) * profile.length)));
				var displacement = profile[sample] || 0;
				var mapX = (-(edgeX / distance) * displacement) / maxDisplacement;
				var mapY = (-(edgeY / distance) * displacement) / maxDisplacement;
				pixels[index] = Math.max(0, Math.min(255, Math.round(128 + mapX * 127 * opacity)));
				pixels[index + 1] = Math.max(0, Math.min(255, Math.round(128 + mapY * 127 * opacity)));
			}
		}

		context.putImageData(image, 0, 0);
		return canvas.toDataURL('image/png');
	}

	function makeCapsuleSpecular(width, height, radius, bezel) {
		var canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		var context = canvas.getContext('2d');
		var image = context.createImageData(width, height);
		var pixels = image.data;
		var radiusSquared = radius * radius;
		var outerRadiusSquared = Math.pow(radius + 1, 2);
		var innerRadiusSquared = Math.pow(Math.max(radius - bezel, 0), 2);
		var straightWidth = width - radius * 2;
		var straightHeight = height - radius * 2;
		var lightX = Math.cos(Math.PI / 3);
		var lightY = Math.sin(Math.PI / 3);

		for (var y = 0; y < height; y += 1) {
			for (var x = 0; x < width; x += 1) {
				var edgeX = x < radius ? x - radius : x >= width - radius ? x - radius - straightWidth : 0;
				var edgeY = y < radius ? y - radius : y >= height - radius ? y - radius - straightHeight : 0;
				var distanceSquared = edgeX * edgeX + edgeY * edgeY;
				if (distanceSquared > outerRadiusSquared || distanceSquared < innerRadiusSquared) continue;
				var distance = Math.sqrt(distanceSquared);
				if (distance === 0) continue;
				var depth = radius - distance;
				var opacity = distanceSquared < radiusSquared ? 1 : Math.max(0, 1 - (distance - radius));
				var direction = Math.abs((edgeX / distance) * lightX + (-edgeY / distance) * lightY);
				var edgeLight = Math.sqrt(Math.max(0, 1 - Math.pow(1 - depth, 2)));
				var intensity = direction * edgeLight;
				var value = Math.floor(255 * intensity);
				var index = (y * width + x) * 4;
				pixels[index] = value;
				pixels[index + 1] = value;
				pixels[index + 2] = value;
				pixels[index + 3] = Math.floor(value * intensity * opacity);
			}
		}

		context.putImageData(image, 0, 0);
		return canvas.toDataURL('image/png');
	}

	function appendGlassFilter(button, filterId, width, height) {
		var defs = createGlassDefs();
		var existing = document.getElementById(filterId);
		if (existing) existing.remove();

		var filter = document.createElementNS(glassSvgNS, 'filter');
		filter.setAttribute('id', filterId);
		filter.setAttribute('x', '0%');
		filter.setAttribute('y', '0%');
		filter.setAttribute('width', '100%');
		filter.setAttribute('height', '100%');
		filter.setAttribute('color-interpolation-filters', 'sRGB');

		var radius = Math.min(width, height) / 2;
		var bezel = Math.min(60, radius - 1, Math.min(width, height) / 2 - 1);
		var profile = makeRefractionProfile(80, bezel, 3, 128);
		var maxDisplacement = Math.max.apply(null, Array.from(profile).map(Math.abs)) || 1;
		var filterScale = maxDisplacement;

		var soften = document.createElementNS(glassSvgNS, 'feGaussianBlur');
		soften.setAttribute('in', 'SourceGraphic');
		soften.setAttribute('stdDeviation', '0.3');
		soften.setAttribute('result', 'softened');

		var map = document.createElementNS(glassSvgNS, 'feImage');
		map.setAttribute('href', makeCapsuleDisplacement(width, height, radius, bezel, profile, maxDisplacement));
		map.setAttribute('width', String(width));
		map.setAttribute('height', String(height));
		map.setAttribute('preserveAspectRatio', 'none');
		map.setAttribute('result', 'capsule-map');

		var displacement = document.createElementNS(glassSvgNS, 'feDisplacementMap');
		displacement.setAttribute('in', 'softened');
		displacement.setAttribute('in2', 'capsule-map');
		displacement.setAttribute('scale', String(filterScale));
		displacement.setAttribute('xChannelSelector', 'R');
		displacement.setAttribute('yChannelSelector', 'G');
		displacement.setAttribute('result', 'refracted');

		var saturated = document.createElementNS(glassSvgNS, 'feColorMatrix');
		saturated.setAttribute('in', 'refracted');
		saturated.setAttribute('type', 'saturate');
		saturated.setAttribute('values', '4');
		saturated.setAttribute('result', 'saturated-refraction');

		var specular = document.createElementNS(glassSvgNS, 'feImage');
		specular.setAttribute('href', makeCapsuleSpecular(width, height, radius, Math.min(radius, bezel * 2.5)));
		specular.setAttribute('width', String(width));
		specular.setAttribute('height', String(height));
		specular.setAttribute('preserveAspectRatio', 'none');
		specular.setAttribute('result', 'specular-map');

		var saturatedEdge = document.createElementNS(glassSvgNS, 'feComposite');
		saturatedEdge.setAttribute('in', 'saturated-refraction');
		saturatedEdge.setAttribute('in2', 'specular-map');
		saturatedEdge.setAttribute('operator', 'in');
		saturatedEdge.setAttribute('result', 'saturated-edge');

		var fadedSpecular = document.createElementNS(glassSvgNS, 'feComponentTransfer');
		fadedSpecular.setAttribute('in', 'specular-map');
		fadedSpecular.setAttribute('result', 'faded-specular');
		var alpha = document.createElementNS(glassSvgNS, 'feFuncA');
		alpha.setAttribute('type', 'linear');
		alpha.setAttribute('slope', '0.5');
		fadedSpecular.appendChild(alpha);

		var coloredGlass = document.createElementNS(glassSvgNS, 'feBlend');
		coloredGlass.setAttribute('in', 'saturated-edge');
		coloredGlass.setAttribute('in2', 'refracted');
		coloredGlass.setAttribute('mode', 'normal');
		coloredGlass.setAttribute('result', 'colored-glass');

		var finalGlass = document.createElementNS(glassSvgNS, 'feBlend');
		finalGlass.setAttribute('in', 'faded-specular');
		finalGlass.setAttribute('in2', 'colored-glass');
		finalGlass.setAttribute('mode', 'normal');

		filter.appendChild(soften);
		filter.appendChild(map);
		filter.appendChild(displacement);
		filter.appendChild(saturated);
		filter.appendChild(specular);
		filter.appendChild(saturatedEdge);
		filter.appendChild(fadedSpecular);
		filter.appendChild(coloredGlass);
		filter.appendChild(finalGlass);
		defs.appendChild(filter);
		button.style.setProperty('--glass-filter', 'url("#' + filterId + '")');
	}

	glassButtons.forEach(function (button, buttonIndex) {
		var filterId = 'ellan-liquid-glass-' + buttonIndex;
		var previousSize = '';
		var refreshGlass = function () {
			if (!isChromium) return;
			var rect = button.getBoundingClientRect();
			var width = Math.max(2, Math.round(rect.width));
			var height = Math.max(2, Math.round(rect.height));
			var size = width + 'x' + height;
			if (size === previousSize) return;
			previousSize = size;
			appendGlassFilter(button, filterId, width, height);
		};

		refreshGlass();
		if ('ResizeObserver' in window) new ResizeObserver(refreshGlass).observe(button);
	});

	var bookmarkBtn = document.getElementById('bookmark-btn');
	if (bookmarkBtn) {
		bookmarkBtn.addEventListener('click', function () {
			window.showToast('按 Ctrl+D (Mac: Cmd+D) 收藏本站');
		});
	}
})();
