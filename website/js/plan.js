// Ellan 艾尔岚 · PLAN 全服聚合数据
(function () {
	'use strict';

	var body = document.body;
	if (!body || !body.classList.contains('plan-page')) return;

	var PROXY_URL = 'api/plan-network.php';
	var REFRESH_MS = 60000;
	var REQUEST_TIMEOUT_MS = 9000;
	var MIN_TIMESTAMP_MS = 1577836800000;

	var status = document.getElementById('plan-status');
	var statusLabel = document.getElementById('plan-status-label');
	var updated = document.getElementById('plan-updated');
	var errorMessage = document.getElementById('plan-error');
	var refreshButton = document.getElementById('plan-refresh');
	var periodBefore = document.getElementById('plan-period-before');
	var periodAfter = document.getElementById('plan-period-after');
	var hasData = false;
	var requestPending = false;
	var coldRetryCount = 0;
	var coldRetryTimer = null;

	var integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
	var dateFormatter = new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	var periodFormatter = new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai',
		month: 'numeric',
		day: 'numeric'
	});

	function finiteNumber(value) {
		var number = typeof value === 'number' ? value : Number(value);
		return Number.isFinite(number) ? number : null;
	}

	function formatInteger(value) {
		var number = finiteNumber(value);
		return number === null ? '--' : integerFormatter.format(Math.round(number));
	}

	function formatHours(value) {
		var milliseconds = finiteNumber(value);
		return milliseconds === null ? '--' : integerFormatter.format(Math.round(milliseconds / 3600000));
	}

	function formatDuration(value) {
		var milliseconds = finiteNumber(value);
		if (milliseconds === null || milliseconds < 0) return '--';
		var totalSeconds = Math.round(milliseconds / 1000);
		var days = Math.floor(totalSeconds / 86400);
		var hours = Math.floor((totalSeconds % 86400) / 3600);
		var minutes = Math.floor((totalSeconds % 3600) / 60);
		var seconds = totalSeconds % 60;
		var parts = [];
		if (days) parts.push(days + ' 天');
		if (hours) parts.push(hours + ' 小时');
		if (minutes && parts.length < 2) parts.push(minutes + ' 分');
		if (!parts.length || (parts.length < 2 && seconds && !days)) parts.push(seconds + ' 秒');
		return parts.slice(0, 2).join(' ');
	}

	function formatDate(value) {
		var timestamp = finiteNumber(value);
		return !validTimestamp(timestamp) ? '--' : dateFormatter.format(new Date(timestamp));
	}

	function formatValue(value, format) {
		if (format === 'hours') return formatHours(value);
		if (format === 'duration') return formatDuration(value);
		if (format === 'date') return formatDate(value);
		return formatInteger(value);
	}

	function sourceFor(data, scope) {
		if (scope === 'players') return data.players;
		if (scope === 'weeks') return data.weeks;
		return data.numbers;
	}

	function renderBindings(data) {
		document.querySelectorAll('[data-plan-key]').forEach(function (element) {
			var source = sourceFor(data, element.getAttribute('data-plan-scope'));
			var key = element.getAttribute('data-plan-key');
			var format = element.getAttribute('data-plan-format') || 'integer';
			element.textContent = formatValue(source && source[key], format);
		});
	}

	var trendRows = [
		{ name: 'unique', before: 'unique_before', after: 'unique_after', format: 'integer' },
		{ name: 'new', before: 'new_before', after: 'new_after', format: 'integer' },
		{ name: 'regular', before: 'regular_before', after: 'regular_after', format: 'integer' },
		{ name: 'average-playtime', before: 'average_playtime_before', after: 'average_playtime_after', format: 'duration' },
		{ name: 'session-length', before: 'session_length_average_before', after: 'session_length_average_after', format: 'duration' },
		{ name: 'sessions', before: 'sessions_before', after: 'sessions_after', format: 'integer' }
	];

	function renderTrends(weeks) {
		trendRows.forEach(function (row) {
			var element = document.querySelector('[data-plan-trend="' + row.name + '"]');
			if (!element) return;
			var before = finiteNumber(weeks[row.before]);
			var after = finiteNumber(weeks[row.after]);
			if (before === null || after === null) {
				element.textContent = '--';
				element.removeAttribute('data-direction');
				return;
			}
			var delta = after - before;
			if (delta === 0) {
				element.textContent = '持平';
				element.setAttribute('data-direction', 'flat');
				element.setAttribute('aria-label', '与上一周期持平');
				return;
			}
			var direction = delta > 0 ? 'up' : 'down';
			var arrow = delta > 0 ? '↑' : '↓';
			var value = row.format === 'duration' ? formatDuration(Math.abs(delta)) : formatInteger(Math.abs(delta));
			element.textContent = arrow + ' ' + value;
			element.setAttribute('data-direction', direction);
			element.setAttribute('aria-label', (delta > 0 ? '增加 ' : '减少 ') + value);
		});
	}

	function formatPeriod(start, end) {
		var startNumber = finiteNumber(start);
		var endNumber = finiteNumber(end);
		if (!validTimestamp(startNumber) || !validTimestamp(endNumber) || startNumber > endNumber) return '--';
		return periodFormatter.format(new Date(startNumber)) + ' — ' + periodFormatter.format(new Date(endNumber));
	}

	function renderPeriods(weeks) {
		if (periodBefore) periodBefore.textContent = formatPeriod(weeks.start, weeks.midpoint);
		if (periodAfter) periodAfter.textContent = formatPeriod(weeks.midpoint, weeks.end);
	}

	function validTimestamp(value) {
		return value !== null && value >= MIN_TIMESTAMP_MS && value <= Date.now() + 86400000 && !Number.isNaN(new Date(value).getTime());
	}

	function validatePayload(data) {
		if (!data || typeof data !== 'object') return false;
		if (!data.numbers || !data.players || !data.weeks) return false;
		return validTimestamp(finiteNumber(data.timestamp)) && finiteNumber(data.numbers.online_players) !== null;
	}

	async function requestJson(url) {
		var controller = typeof AbortController === 'function' ? new AbortController() : null;
		var timeout;
		var timeoutPromise = new Promise(function (resolve, reject) {
			timeout = setTimeout(function () {
				if (controller) controller.abort();
				reject(new Error('PLAN request timed out'));
			}, REQUEST_TIMEOUT_MS);
		});
		try {
			var request = fetch(url, {
				cache: 'default',
				credentials: 'same-origin',
				signal: controller ? controller.signal : undefined,
				headers: { Accept: 'application/json' }
			}).then(async function (response) {
				if (!response.ok) {
					var requestError = new Error('HTTP ' + response.status);
					requestError.status = response.status;
					requestError.retryAfter = Number(response.headers.get('retry-after')) || 0;
					throw requestError;
				}
				var contentType = response.headers.get('content-type') || '';
				if (contentType.indexOf('application/json') === -1) throw new Error('Unexpected response type');
				return {
					data: await response.json(),
					stale: response.headers.get('x-plan-data-stale') === '1'
				};
			});
			return await Promise.race([request, timeoutPromise]);
		} finally {
			clearTimeout(timeout);
		}
	}

	async function loadPayload() {
		var result = await requestJson(PROXY_URL);
		if (!validatePayload(result.data)) throw new Error('Invalid PLAN payload');
		return result;
	}

	function setLoading(loading) {
		requestPending = loading;
		body.classList.toggle(hasData ? 'is-refreshing' : 'is-loading', loading);
		if (refreshButton) refreshButton.disabled = loading;
		if (loading && statusLabel) statusLabel.textContent = hasData ? '正在同步最新数据' : '正在连接 PLAN 数据';
	}

	function renderSuccess(data, stale) {
		renderBindings(data);
		renderTrends(data.weeks);
		renderPeriods(data.weeks);
		hasData = true;
		coldRetryCount = 0;
		if (coldRetryTimer) clearTimeout(coldRetryTimer);
		body.classList.remove('is-loading', 'is-refreshing', 'has-plan-error');
		body.classList.add('is-loaded', 'has-plan-data');
		body.classList.toggle('has-plan-stale', stale);
		if (status) status.classList.remove('is-error');
		if (statusLabel) statusLabel.textContent = stale ? '显示最近缓存数据' : 'PLAN 数据已同步';
		if (errorMessage) {
			errorMessage.textContent = 'PLAN 暂时未响应，正在显示最近一次成功同步的数据。';
			errorMessage.hidden = !stale;
		}
		var timestamp = finiteNumber(data.timestamp) || Date.now();
		if (updated) {
			updated.dateTime = new Date(timestamp).toISOString();
			updated.textContent = '更新于 ' + dateFormatter.format(new Date(timestamp));
		}
	}

	function renderFailure(retrying) {
		body.classList.remove('is-loading', 'is-refreshing');
		body.classList.remove('has-plan-stale');
		body.classList.add('has-plan-error');
		if (status) status.classList.add('is-error');
		if (statusLabel) statusLabel.textContent = retrying ? 'PLAN 数据正在同步' : (hasData ? '同步失败，仍显示上次数据' : 'PLAN 数据暂时不可用');
		if (errorMessage) {
			errorMessage.textContent = retrying ? '首批数据正在生成，页面将在数秒后自动重试。' : (hasData ? '最新一轮同步未完成，页面会在 60 秒后再次尝试。' : '数据暂时没有抵达，请稍后重试。');
			errorMessage.hidden = false;
		}
	}

	function scheduleColdRetry(error) {
		if (hasData || !error || error.status !== 503 || coldRetryCount >= 3) return false;
		coldRetryCount += 1;
		var delay = Math.max(1000, Math.min((error.retryAfter || 2) * 1000, 5000));
		if (coldRetryTimer) clearTimeout(coldRetryTimer);
		coldRetryTimer = setTimeout(fetchOverview, delay);
		return true;
	}

	async function fetchOverview() {
		if (requestPending || document.hidden) return;
		setLoading(true);
		try {
			var result = await loadPayload();
			renderSuccess(result.data, result.stale);
		} catch (error) {
			renderFailure(scheduleColdRetry(error));
		} finally {
			setLoading(false);
		}
	}

	if (refreshButton) refreshButton.addEventListener('click', fetchOverview);
	document.addEventListener('visibilitychange', function () {
		if (!document.hidden) fetchOverview();
	});
	window.addEventListener('online', fetchOverview);

	fetchOverview();
	setInterval(fetchOverview, REFRESH_MS);
})();
