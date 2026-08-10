// Ellan 艾尔岚 · PLAN 全服聚合数据
(function () {
	'use strict';

	var body = document.body;
	if (!body || !body.classList.contains('plan-page')) return;

	var PROXY_URL = 'api/plan-network.php';
	var PERFORMANCE_URL = 'api/plan-performance.php';
	var REFRESH_MS = 60000;
	var PERFORMANCE_REFRESH_MS = 300000;
	var REQUEST_TIMEOUT_MS = 9000;
	var PERFORMANCE_REQUEST_TIMEOUT_MS = 20000;
	var MIN_TIMESTAMP_MS = 1577836800000;

	var status = document.getElementById('plan-status');
	var statusLabel = document.getElementById('plan-status-label');
	var updated = document.getElementById('plan-updated');
	var errorMessage = document.getElementById('plan-error');
	var refreshButton = document.getElementById('plan-refresh');
	var chartStatus = document.getElementById('plan-chart-status');
	var hasData = false;
	var requestPending = false;
	var hasPerformanceData = false;
	var performancePending = false;
	var lastPerformanceFetch = 0;
	var lastPerformanceData = null;
	var currentOnlinePlayers = null;
	var currentOnlineTimestamp = null;
	var coldRetryCount = 0;
	var coldRetryTimer = null;

	var integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
	var decimalFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	var memoryFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	var dateFormatter = new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai',
		month: 'long',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	function finiteNumber(value) {
		if (value === null || value === '' || typeof value === 'boolean') return null;
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
		return data.numbers;
	}

	function asTimeElement(element, timestamp) {
		if (!element || !validTimestamp(timestamp)) return element;
		if (element.tagName !== 'TIME') {
			var time = document.createElement('time');
			Array.from(element.attributes).forEach(function (attribute) {
				time.setAttribute(attribute.name, attribute.value);
			});
			element.replaceWith(time);
			element = time;
		}
		element.dateTime = new Date(timestamp).toISOString();
		return element;
	}

	function renderBindings(data) {
		document.querySelectorAll('[data-plan-key]').forEach(function (element) {
			var source = sourceFor(data, element.getAttribute('data-plan-scope'));
			var key = element.getAttribute('data-plan-key');
			var format = element.getAttribute('data-plan-format') || 'integer';
			var value = source && source[key];
			if (format === 'date') element = asTimeElement(element, finiteNumber(value));
			element.textContent = formatValue(value, format);
		});
	}

	function chartValue(name, value) {
		if (name === 'tps') return decimalFormatter.format(value);
		if (name === 'memory') return memoryFormatter.format(value / 1024);
		return integerFormatter.format(Math.round(value));
	}

	function spokenChartValue(name, value) {
		if (name === 'tps') return chartValue(name, value) + ' TPS';
		if (name === 'memory') return chartValue(name, value) + ' GB';
		return chartValue(name, value) + ' 人';
	}

	function validChartSeries(series, minimum, maximum, bucketMs, expectedPoints) {
		if (!Array.isArray(series) || series.length !== expectedPoints) return false;
		var previous = null;
		var numericPoints = 0;
		var valid = series.every(function (point) {
			if (!Array.isArray(point) || point.length !== 2) return false;
			var timestamp = finiteNumber(point[0]);
			if (!validTimestamp(timestamp) || timestamp % bucketMs !== 0 || (previous !== null && timestamp !== previous + bucketMs)) return false;
			if (point[1] !== null) {
				var value = finiteNumber(point[1]);
				if (value === null || value < minimum || value > maximum) return false;
				numericPoints += 1;
			}
			previous = timestamp;
			return true;
		});
		return valid && numericPoints >= 2;
	}

	function validatePerformancePayload(data) {
		if (!data || typeof data !== 'object' || !data.current || !data.series) return false;
		var currentTps = finiteNumber(data.current.tps);
		var currentMemory = finiteNumber(data.current.memory_mb);
		var currentPlayers = finiteNumber(data.current.players);
		var refreshSeconds = finiteNumber(data.refresh_seconds);
		var expectedPoints = data.window_ms / data.bucket_ms + 1;
		return validTimestamp(finiteNumber(data.timestamp))
			&& data.window_ms === 86400000
			&& data.bucket_ms === 600000
			&& refreshSeconds !== null && refreshSeconds >= 60 && refreshSeconds <= 3600
			&& currentTps !== null && currentTps >= 0 && currentTps <= 21
			&& currentMemory !== null && currentMemory >= 0 && currentMemory <= 1000000
			&& currentPlayers !== null && currentPlayers >= 0 && currentPlayers <= 1000000
			&& validChartSeries(data.series.tps, 0, 21, data.bucket_ms, expectedPoints)
			&& validChartSeries(data.series.memory, 0, 1000000, data.bucket_ms, expectedPoints)
			&& validChartSeries(data.series.players, 0, 1000000, data.bucket_ms, expectedPoints);
	}

	function chartDomain(name, values) {
		var minimum = Math.min.apply(null, values);
		var maximum = Math.max.apply(null, values);
		if (name === 'tps') {
			return {
				minimum: Math.max(0, Math.min(18, Math.floor(minimum * 10) / 10 - .1)),
				maximum: Math.min(21, Math.max(20, Math.ceil(maximum * 10) / 10 + .1))
			};
		}
		return { minimum: 0, maximum: Math.max(1, maximum * 1.08) };
	}

	function renderChart(name, series, current) {
		var card = document.querySelector('[data-plan-chart="' + name + '"]');
		if (!card) return;
		var values = series.filter(function (point) { return point[1] !== null; }).map(function (point) { return point[1]; });
		var domain = chartDomain(name, values);
		var range = Math.max(.01, domain.maximum - domain.minimum);
		var firstTimestamp = series[0][0];
		var timeRange = Math.max(1, series[series.length - 1][0] - firstTimestamp);
		var coordinates = series.map(function (point) {
			if (point[1] === null) return null;
			var x = (point[0] - firstTimestamp) / timeRange * 360;
			var y = 8 + (1 - (point[1] - domain.minimum) / range) * 134;
			return [x, Math.max(8, Math.min(142, y))];
		});
		var segments = [];
		var segment = [];
		coordinates.forEach(function (point) {
			if (point) {
				segment.push(point);
			} else if (segment.length) {
				segments.push(segment);
				segment = [];
			}
		});
		if (segment.length) segments.push(segment);
		function segmentPath(points) {
			return points.map(function (point, index) {
				return (index ? 'L' : 'M') + point[0].toFixed(2) + ',' + point[1].toFixed(2);
			}).join(' ');
		}
		var line = segments.map(segmentPath).join(' ');
		var area = segments.map(function (points) {
			var firstPoint = points[0];
			var lastPoint = points[points.length - 1];
			return segmentPath(points) + ' L' + lastPoint[0].toFixed(2) + ',150 L' + firstPoint[0].toFixed(2) + ',150 Z';
		}).join(' ');
		var plottedPoints = coordinates.filter(function (point) { return point !== null; });
		var last = plottedPoints[plottedPoints.length - 1];
		var minimum = Math.min.apply(null, values);
		var maximum = Math.max.apply(null, values);
		card.querySelector('[data-plan-chart-line]').setAttribute('d', line);
		card.querySelector('[data-plan-chart-area]').setAttribute('d', area);
		card.querySelector('[data-plan-chart-point]').setAttribute('cx', last[0].toFixed(2));
		card.querySelector('[data-plan-chart-point]').setAttribute('cy', last[1].toFixed(2));
		card.querySelector('[data-plan-chart-value]').textContent = chartValue(name, current);
		card.querySelector('[data-plan-chart-min]').textContent = '低 ' + chartValue(name, minimum);
		card.querySelector('[data-plan-chart-max]').textContent = '高 ' + chartValue(name, maximum);
		card.querySelector('[data-plan-chart-desc]').textContent = '近 24 小时，当前 ' + spokenChartValue(name, current) + '，最低 ' + spokenChartValue(name, minimum) + '，最高 ' + spokenChartValue(name, maximum) + (values.length < series.length ? '，部分时段无数据。' : '。');
		card.querySelector('[data-plan-chart-empty]').hidden = true;
		card.classList.remove('is-empty');
	}

	function renderPerformance(data, stale) {
		renderChart('tps', data.series.tps, data.current.tps);
		renderChart('memory', data.series.memory, data.current.memory_mb);
		lastPerformanceData = data;
		renderPlayerChart();
		hasPerformanceData = true;
		body.classList.add('has-plan-charts');
		if (chartStatus) chartStatus.textContent = stale ? '缓存数据' : Math.round(data.refresh_seconds / 60) + ' 分钟同步';
	}

	function renderPerformanceFailure() {
		if (chartStatus) chartStatus.textContent = hasPerformanceData ? '更新延迟' : '暂不可用';
		if (hasPerformanceData) {
			document.querySelectorAll('[data-plan-chart-desc]').forEach(function (description) {
				if (description.textContent.indexOf('更新延迟') === -1) {
					description.textContent = description.textContent.replace(/。$/, '') + '；当前更新延迟。';
				}
			});
			return;
		}
		document.querySelectorAll('[data-plan-chart]').forEach(function (card) {
			card.classList.add('is-empty');
			var empty = card.querySelector('[data-plan-chart-empty]');
			if (empty) empty.textContent = '暂不可用';
			var description = card.querySelector('[data-plan-chart-desc]');
			if (description) description.textContent = '近 24 小时数据暂不可用。';
		});
	}

	function renderPlayerChart() {
		if (!lastPerformanceData) return;
		var series = lastPerformanceData.series.players.map(function (point) { return point.slice(); });
		var current = lastPerformanceData.current.players;
		if (currentOnlinePlayers !== null && currentOnlineTimestamp !== null && currentOnlineTimestamp >= lastPerformanceData.timestamp) {
			var last = series[series.length - 1];
			var currentBucket = Math.floor(currentOnlineTimestamp / lastPerformanceData.bucket_ms) * lastPerformanceData.bucket_ms;
			if (currentBucket === last[0]) {
				last[1] = currentOnlinePlayers;
				current = currentOnlinePlayers;
			} else if (currentBucket === last[0] + lastPerformanceData.bucket_ms) {
				series.push([currentBucket, currentOnlinePlayers]);
				series.shift();
				current = currentOnlinePlayers;
			}
		}
		renderChart('players', series, current);
	}

	function validTimestamp(value) {
		return value !== null && value >= MIN_TIMESTAMP_MS && value <= Date.now() + 86400000 && !Number.isNaN(new Date(value).getTime());
	}

	function validatePayload(data) {
		if (!data || typeof data !== 'object') return false;
		if (!data.numbers || !data.players) return false;
		return validTimestamp(finiteNumber(data.timestamp)) && finiteNumber(data.numbers.online_players) !== null;
	}

	async function requestJson(url, timeoutMs) {
		var controller = typeof AbortController === 'function' ? new AbortController() : null;
		var timeout;
		var timeoutPromise = new Promise(function (resolve, reject) {
			timeout = setTimeout(function () {
				if (controller) controller.abort();
				reject(new Error('PLAN request timed out'));
			}, timeoutMs || REQUEST_TIMEOUT_MS);
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

	async function loadPerformancePayload() {
		var result = await requestJson(PERFORMANCE_URL, PERFORMANCE_REQUEST_TIMEOUT_MS);
		if (!validatePerformancePayload(result.data)) throw new Error('Invalid PLAN performance payload');
		return result;
	}

	function setLoading(loading) {
		requestPending = loading;
		body.classList.toggle(hasData ? 'is-refreshing' : 'is-loading', loading);
		if (refreshButton) refreshButton.disabled = loading;
		if (loading && statusLabel) statusLabel.textContent = hasData ? '同步中' : '连接中';
	}

	function renderSuccess(data, stale) {
		renderBindings(data);
		currentOnlinePlayers = finiteNumber(data.numbers.online_players);
		currentOnlineTimestamp = finiteNumber(data.timestamp);
		renderPlayerChart();
		hasData = true;
		coldRetryCount = 0;
		if (coldRetryTimer) clearTimeout(coldRetryTimer);
		body.classList.remove('is-loading', 'is-refreshing', 'has-plan-error');
		body.classList.add('is-loaded', 'has-plan-data');
		body.classList.toggle('has-plan-stale', stale);
		if (status) status.classList.remove('is-error');
		if (statusLabel) statusLabel.textContent = stale ? '缓存数据' : '已同步';
		if (errorMessage) {
			errorMessage.textContent = '最新数据延迟，正在显示缓存。';
			errorMessage.hidden = !stale;
		}
		var timestamp = finiteNumber(data.timestamp) || Date.now();
		if (updated) {
			updated = asTimeElement(updated, timestamp);
			updated.textContent = '更新于 ' + dateFormatter.format(new Date(timestamp));
		}
	}

	function renderFailure(retrying) {
		body.classList.remove('is-loading', 'is-refreshing');
		body.classList.remove('has-plan-stale');
		body.classList.add('has-plan-error');
		if (status) status.classList.add('is-error');
		if (statusLabel) statusLabel.textContent = retrying ? '同步中' : (hasData ? '更新延迟' : '暂不可用');
		if (errorMessage) {
			errorMessage.textContent = retrying ? '正在生成首批数据。' : (hasData ? '将在 60 秒后重试。' : '数据暂不可用。');
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

	async function fetchPerformance(force) {
		if (performancePending || document.hidden) return;
		if (!force && hasPerformanceData && Date.now() - lastPerformanceFetch < PERFORMANCE_REFRESH_MS) return;
		performancePending = true;
		body.classList.add('is-refreshing-performance');
		var trends = document.querySelector('.plan-trends');
		if (trends) trends.setAttribute('aria-busy', 'true');
		if (chartStatus) chartStatus.textContent = hasPerformanceData ? '同步中' : '读取中';
		try {
			var result = await loadPerformancePayload();
			renderPerformance(result.data, result.stale);
			lastPerformanceFetch = Date.now();
		} catch (error) {
			renderPerformanceFailure();
		} finally {
			performancePending = false;
			body.classList.remove('is-refreshing-performance');
			if (trends) trends.removeAttribute('aria-busy');
		}
	}

	function refreshAll(forcePerformance) {
		fetchOverview();
		fetchPerformance(forcePerformance);
	}

	if (refreshButton) refreshButton.addEventListener('click', function () { refreshAll(true); });
	document.addEventListener('visibilitychange', function () {
		if (!document.hidden) refreshAll(false);
	});
	window.addEventListener('online', function () { refreshAll(true); });

	refreshAll(true);
	setInterval(function () { refreshAll(false); }, REFRESH_MS);
})();
