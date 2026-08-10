// Ellan 艾尔岚 · PLAN 群组运行遥测
(function () {
	'use strict';

	var body = document.body;
	if (!body || !body.classList.contains('plan-page')) return;

	var OVERVIEW_URL = 'api/plan-network.php';
	var PERFORMANCE_URL = 'api/plan-performance.php';
	var OVERVIEW_REFRESH_MS = 60000;
	var PERFORMANCE_REFRESH_MS = 300000;
	var REQUEST_TIMEOUT_MS = 9000;
	var PERFORMANCE_REQUEST_TIMEOUT_MS = 30000;
	var MIN_TIMESTAMP_MS = 1577836800000;
	var SVG_NS = 'http://www.w3.org/2000/svg';
	var CHART = { left: 58, right: 740, top: 20, bottom: 302, width: 682, height: 282 };
	var NODE_IDS = ['redstone', 'spawn', 'survival'];
	var RANGE_CONFIG = {
		'6h': { label: '6 小时', window: 21600000, bucket: 120000, points: 181 },
		'24h': { label: '24 小时', window: 86400000, bucket: 600000, points: 145 },
		'7d': { label: '7 天', window: 604800000, bucket: 3600000, points: 169 },
		'30d': { label: '30 天', window: 2592000000, bucket: 21600000, points: 121 }
	};
	var METRICS = {
		players: { label: '在线玩家', short: '在线', unit: '人', minimum: 0, maximum: 1000000, decimals: 0, zero: true },
		tps: { label: 'TPS', short: 'TPS', unit: '', minimum: 0, maximum: 21, decimals: 2, tps: true },
		cpu: { label: 'CPU 占用', short: 'CPU', unit: '%', minimum: 0, maximum: 100, decimals: 1, zero: true },
		memory_mb: { label: '内存占用', short: '内存', unit: 'GB', minimum: 0, maximum: 1000000, decimals: 1, divide: 1024, zero: true },
		entities: { label: '加载实体', short: '实体', unit: '', minimum: 0, maximum: 100000000, decimals: 0, zero: true },
		chunks: { label: '加载区块', short: '区块', unit: '', minimum: 0, maximum: 100000000, decimals: 0, zero: true },
		disk_mb: { label: '可用磁盘', short: '磁盘', unit: 'GB', minimum: 0, maximum: 1000000000, decimals: 1, divide: 1024 },
		mspt_average: { label: '平均 MSPT', short: '平均 MSPT', unit: 'ms', minimum: 0, maximum: 1000000, decimals: 2, zero: true },
		mspt_p95: { label: 'P95 MSPT', short: 'P95 MSPT', unit: 'ms', minimum: 0, maximum: 1000000, decimals: 2, zero: true },
		ping_min: { label: '最低延迟', short: '最低延迟', unit: 'ms', minimum: 0, maximum: 1000000, decimals: 1, zero: true },
		ping_average: { label: '平均延迟', short: '平均延迟', unit: 'ms', minimum: 0, maximum: 1000000, decimals: 1, zero: true },
		ping_max: { label: '最高延迟', short: '最高延迟', unit: 'ms', minimum: 0, maximum: 1000000, decimals: 1, zero: true },
		cpu_max: { label: '最高节点 CPU', short: '最高 CPU', unit: '%', minimum: 0, maximum: 100, decimals: 1, zero: true },
		memory_total_mb: { label: '节点内存合计', short: '内存合计', unit: 'GB', minimum: 0, maximum: 3000000, decimals: 1, divide: 1024, zero: true },
		entities_total: { label: '实体合计', short: '实体合计', unit: '', minimum: 0, maximum: 300000000, decimals: 0, zero: true },
		chunks_total: { label: '区块合计', short: '区块合计', unit: '', minimum: 0, maximum: 300000000, decimals: 0, zero: true },
		tps_min: { label: '最低节点 TPS', short: '最低 TPS', unit: '', minimum: 0, maximum: 21, decimals: 2, tps: true },
		mspt_p95_max: { label: '最高节点 P95 MSPT', short: '最高 P95', unit: 'ms', minimum: 0, maximum: 1000000, decimals: 2, zero: true },
		reporting_nodes: { label: '上报节点数', short: '上报节点', unit: '/ 3', minimum: 0, maximum: 3, decimals: 0, zero: true }
	};
	var CATEGORIES = {
		network: { label: '群组汇总', metrics: ['players', 'cpu_max', 'memory_total_mb', 'tps_min', 'mspt_p95_max', 'entities_total', 'chunks_total', 'reporting_nodes'] },
		performance: { label: '节点性能', metrics: ['tps', 'cpu', 'memory_mb', 'mspt_average', 'mspt_p95'] },
		world: { label: '世界负载', metrics: ['players', 'entities', 'chunks', 'disk_mb'] },
		latency: { label: '网络延迟', metrics: ['ping_average', 'ping_min', 'ping_max'] }
	};

	var status = document.getElementById('plan-status');
	var statusLabel = document.getElementById('plan-status-label');
	var updated = document.getElementById('plan-updated');
	var errorMessage = document.getElementById('plan-error');
	var refreshButton = document.getElementById('plan-refresh');
	var chartStatus = document.getElementById('plan-chart-status');
	var categoryPicker = document.getElementById('plan-category-picker');
	var metricPicker = document.getElementById('plan-metric-picker');
	var nodePicker = document.getElementById('plan-node-picker');
	var resetButton = document.getElementById('plan-chart-reset');
	var chartStage = document.getElementById('plan-chart-stage');
	var chartToolbar = document.querySelector('.plan-chart-toolbar');
	var chartSvg = document.getElementById('plan-performance-chart');
	var chartGrid = chartSvg && chartSvg.querySelector('[data-plan-chart-grid]');
	var chartLines = chartSvg && chartSvg.querySelector('[data-plan-chart-lines]');
	var chartFocus = chartSvg && chartSvg.querySelector('[data-plan-chart-focus]');
	var chartCrosshair = chartSvg && chartSvg.querySelector('[data-plan-chart-crosshair]');
	var chartSelection = chartSvg && chartSvg.querySelector('[data-plan-chart-selection]');
	var chartInteraction = chartSvg && chartSvg.querySelector('[data-plan-chart-interaction]');
	var chartTooltip = document.getElementById('plan-chart-tooltip');
	var chartEmpty = document.getElementById('plan-chart-empty');
	var chartLegend = document.getElementById('plan-chart-legend');
	var chartScope = document.getElementById('plan-chart-scope');
	var chartTitle = document.getElementById('plan-chart-title');
	var chartWindow = document.getElementById('plan-chart-window');
	var chartDescription = document.getElementById('plan-performance-desc');
	var chartLiveStatus = document.getElementById('plan-chart-live-status');
	var statCaption = document.getElementById('plan-stat-caption');
	var statPointLabel = document.getElementById('plan-stat-point-label');
	var statBody = document.getElementById('plan-stat-body');
	var snapshotBody = document.getElementById('plan-snapshot-body');

	var hasOverviewData = false;
	var overviewPending = false;
	var performancePending = false;
	var hasPerformanceData = false;
	var lastPerformanceFetch = 0;
	var performanceData = null;
	var currentOnlinePlayers = null;
	var currentOnlineTimestamp = null;
	var coldRetryCount = 0;
	var coldRetryTimer = null;
	var activeRange = '24h';
	var activeCategory = 'network';
	var activeMetric = 'players';
	var selectedNodes = new Set(NODE_IDS);
	var zoomStart = null;
	var zoomEnd = null;
	var focusIndex = null;
	var dragStartX = null;
	var dragCurrentX = null;

	var integerFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 });
	var decimalFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
	var preciseFormatter = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	var dateFormatter = new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
	});
	var compactTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
	});
	var shortTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false
	});

	function finiteNumber(value) {
		if (value === null || value === '' || typeof value === 'boolean') return null;
		var number = typeof value === 'number' ? value : Number(value);
		return Number.isFinite(number) ? number : null;
	}

	function validTimestamp(value) {
		return value !== null && value >= MIN_TIMESTAMP_MS && value <= Date.now() + 86400000 && !Number.isNaN(new Date(value).getTime());
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
		return scope === 'players' ? data.players : data.numbers;
	}

	function asTimeElement(element, timestamp) {
		if (!element || !validTimestamp(timestamp)) return element;
		if (element.tagName !== 'TIME') {
			var time = document.createElement('time');
			Array.from(element.attributes).forEach(function (attribute) { time.setAttribute(attribute.name, attribute.value); });
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

	function metricValue(metric, value, includeUnit) {
		var definition = METRICS[metric];
		var number = finiteNumber(value);
		if (!definition || number === null) return '--';
		if (definition.divide) number /= definition.divide;
		var formatted = definition.decimals === 0 ? integerFormatter.format(Math.round(number))
			: definition.decimals === 1 ? decimalFormatter.format(number) : preciseFormatter.format(number);
		if (!includeUnit || !definition.unit) return formatted;
		return formatted + (definition.unit.indexOf('/') === 0 ? ' ' : ' ') + definition.unit;
	}

	function metricAxisValue(metric, value) {
		var definition = METRICS[metric];
		var number = definition && definition.divide ? value / definition.divide : value;
		if (Math.abs(number) >= 1000000) return (number / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
		if (Math.abs(number) >= 1000) return (number / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
		if (Math.abs(number) >= 100) return Math.round(number).toString();
		return number.toFixed(number < 10 ? 1 : 0).replace(/\.0$/, '');
	}

	function sameKeys(object, expected) {
		if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
		var keys = Object.keys(object).sort();
		return keys.length === expected.length && keys.every(function (key, index) { return key === expected.slice().sort()[index]; });
	}

	function validNullableNumber(value, minimum, maximum) {
		if (value === null) return true;
		var number = finiteNumber(value);
		return number !== null && number >= minimum && number <= maximum;
	}

	function validatePerformancePayload(data) {
		if (!data || typeof data !== 'object' || !Array.isArray(data.nodes) || !data.ranges || !data.network) return false;
		if (!validTimestamp(finiteNumber(data.timestamp)) || finiteNumber(data.refresh_seconds) !== 300 || data.nodes.length !== 3) return false;
		var nodeMetricKeys = ['players', 'tps', 'cpu', 'memory_mb', 'entities', 'chunks', 'disk_mb', 'mspt_average', 'mspt_p95', 'ping_min', 'ping_average', 'ping_max'];
		var networkMetricKeys = ['players', 'cpu_max', 'memory_total_mb', 'entities_total', 'chunks_total', 'tps_min', 'mspt_p95_max', 'reporting_nodes'];
		if (!sameKeys(data.ranges, Object.keys(RANGE_CONFIG))) return false;
		for (var range in RANGE_CONFIG) {
			var config = RANGE_CONFIG[range];
			var metadata = data.ranges[range];
			if (!metadata || metadata.label !== config.label || metadata.window_ms !== config.window || metadata.bucket_ms !== config.bucket || !Array.isArray(metadata.timestamps) || metadata.timestamps.length !== config.points) return false;
			for (var index = 0; index < metadata.timestamps.length; index += 1) {
				var timestamp = finiteNumber(metadata.timestamps[index]);
				if (!validTimestamp(timestamp) || timestamp % config.bucket !== 0 || (index && timestamp !== metadata.timestamps[index - 1] + config.bucket)) return false;
			}
		}
		for (var nodeIndex = 0; nodeIndex < data.nodes.length; nodeIndex += 1) {
			var node = data.nodes[nodeIndex];
			if (!node || node.id !== NODE_IDS[nodeIndex] || typeof node.label !== 'string' || typeof node.color !== 'string' || typeof node.fresh !== 'boolean' || !validTimestamp(finiteNumber(node.timestamp)) || !sameKeys(node.current, nodeMetricKeys) || !sameKeys(node.series, Object.keys(RANGE_CONFIG))) return false;
			for (var metricIndex = 0; metricIndex < nodeMetricKeys.length; metricIndex += 1) {
				var metric = nodeMetricKeys[metricIndex];
				var definition = METRICS[metric];
				if (!validNullableNumber(node.current[metric], definition.minimum, definition.maximum)) return false;
				for (var nodeRange in RANGE_CONFIG) {
					var values = node.series[nodeRange] && node.series[nodeRange][metric];
					if (!Array.isArray(values) || values.length !== RANGE_CONFIG[nodeRange].points || !values.every(function (value) { return validNullableNumber(value, definition.minimum, definition.maximum); })) return false;
				}
			}
		}
		if (!sameKeys(data.network.current, networkMetricKeys) || !sameKeys(data.network.series, Object.keys(RANGE_CONFIG)) || !validTimestamp(finiteNumber(data.network.timestamp))) return false;
		for (var networkMetricIndex = 0; networkMetricIndex < networkMetricKeys.length; networkMetricIndex += 1) {
			var networkMetric = networkMetricKeys[networkMetricIndex];
			var networkDefinition = METRICS[networkMetric];
			if (!validNullableNumber(data.network.current[networkMetric], networkDefinition.minimum, networkDefinition.maximum)) return false;
			for (var networkRange in RANGE_CONFIG) {
				var networkValues = data.network.series[networkRange] && data.network.series[networkRange][networkMetric];
				if (!Array.isArray(networkValues) || networkValues.length !== RANGE_CONFIG[networkRange].points || !networkValues.every(function (value) { return validNullableNumber(value, networkDefinition.minimum, networkDefinition.maximum); })) return false;
			}
		}
		return true;
	}

	function createButton(label, className, pressed, clickHandler) {
		var button = document.createElement('button');
		button.type = 'button';
		button.className = className || '';
		button.textContent = label;
		button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
		if (pressed) button.classList.add('is-active');
		button.addEventListener('click', clickHandler);
		return button;
	}

	function renderControlPickers() {
		if (categoryPicker) {
			categoryPicker.replaceChildren();
			Object.keys(CATEGORIES).forEach(function (category) {
				categoryPicker.appendChild(createButton(CATEGORIES[category].label, '', category === activeCategory, function () {
					if (activeCategory === category) return;
					activeCategory = category;
					activeMetric = CATEGORIES[category].metrics[0];
					resetZoom(false);
					renderControlPickers();
					renderPerformanceChart();
				}));
			});
		}
		if (metricPicker) {
			metricPicker.replaceChildren();
			CATEGORIES[activeCategory].metrics.forEach(function (metric) {
				metricPicker.appendChild(createButton(METRICS[metric].short, '', metric === activeMetric, function () {
					activeMetric = metric;
					resetZoom(false);
					renderControlPickers();
					renderPerformanceChart();
				}));
			});
		}
		if (nodePicker) {
			nodePicker.replaceChildren();
			nodePicker.parentElement.hidden = activeCategory === 'network';
			if (chartToolbar) chartToolbar.classList.toggle('is-network', activeCategory === 'network');
			if (performanceData) {
				performanceData.nodes.forEach(function (node) {
					var button = createButton(node.label, '', selectedNodes.has(node.id), function () {
						if (selectedNodes.has(node.id) && selectedNodes.size === 1) return;
						if (selectedNodes.has(node.id)) selectedNodes.delete(node.id); else selectedNodes.add(node.id);
						renderControlPickers();
						renderPerformanceChart();
					});
					button.style.setProperty('--node-color', node.color);
					nodePicker.appendChild(button);
				});
			}
		}
	}

	function activeSeries() {
		if (!performanceData) return [];
		if (activeCategory === 'network') {
			var values = performanceData.network.series[activeRange][activeMetric].slice();
			var livePlayers = currentOnlineValue();
			if (activeMetric === 'players' && livePlayers !== null) {
				var timestamps = performanceData.ranges[activeRange].timestamps;
				var lastIndex = timestamps.length - 1;
				if (currentOnlineTimestamp >= timestamps[lastIndex] && currentOnlineTimestamp < timestamps[lastIndex] + performanceData.ranges[activeRange].bucket_ms) values[lastIndex] = livePlayers;
			}
			return [{ id: 'network', label: '群组', color: '#8fdd55', values: values, current: activeMetric === 'players' && livePlayers !== null ? livePlayers : performanceData.network.current[activeMetric] }];
		}
		return performanceData.nodes.filter(function (node) { return selectedNodes.has(node.id); }).map(function (node) {
			return { id: node.id, label: node.label, color: node.color, values: node.series[activeRange][activeMetric], current: node.current[activeMetric], fresh: node.fresh };
		});
	}

	function currentOnlineValue() {
		if (!performanceData || currentOnlinePlayers === null || currentOnlineTimestamp === null || currentOnlineTimestamp < performanceData.network.timestamp) return null;
		return currentOnlinePlayers;
	}

	function chartBounds(pointCount) {
		var start = zoomStart === null ? 0 : Math.max(0, Math.min(zoomStart, pointCount - 2));
		var end = zoomEnd === null ? pointCount - 1 : Math.max(start + 1, Math.min(zoomEnd, pointCount - 1));
		return { start: start, end: end };
	}

	function chartDomain(series, bounds) {
		var values = [];
		series.forEach(function (item) {
			for (var index = bounds.start; index <= bounds.end; index += 1) {
				if (item.values[index] !== null) values.push(item.values[index]);
			}
		});
		if (!values.length) return null;
		var minimum = Math.min.apply(null, values);
		var maximum = Math.max.apply(null, values);
		var definition = METRICS[activeMetric];
		if (definition.tps) {
			minimum = Math.max(0, Math.min(18, Math.floor(minimum * 10) / 10 - .2));
			maximum = Math.min(21, Math.max(20, Math.ceil(maximum * 10) / 10 + .2));
		} else if (definition.zero) {
			minimum = 0;
			maximum = Math.max(1, maximum * 1.08);
		} else {
			var padding = Math.max(1, (maximum - minimum) * .12);
			minimum = Math.max(0, minimum - padding);
			maximum += padding;
		}
		if (maximum <= minimum) maximum = minimum + 1;
		return { minimum: minimum, maximum: maximum };
	}

	function svgElement(name, attributes, text) {
		var element = document.createElementNS(SVG_NS, name);
		Object.keys(attributes || {}).forEach(function (key) { element.setAttribute(key, attributes[key]); });
		if (text !== undefined) element.textContent = text;
		return element;
	}

	function pathForValues(values, bounds, domain) {
		var segments = [];
		var segment = [];
		var denominator = Math.max(1, bounds.end - bounds.start);
		for (var index = bounds.start; index <= bounds.end; index += 1) {
			var value = values[index];
			if (value === null) {
				if (segment.length) segments.push(segment);
				segment = [];
				continue;
			}
			var x = CHART.left + (index - bounds.start) / denominator * CHART.width;
			var y = CHART.top + (1 - (value - domain.minimum) / (domain.maximum - domain.minimum)) * CHART.height;
			segment.push([x, Math.max(CHART.top, Math.min(CHART.bottom, y))]);
		}
		if (segment.length) segments.push(segment);
		return segments.map(function (points) {
			return points.map(function (point, pointIndex) {
				return (pointIndex ? 'L' : 'M') + point[0].toFixed(2) + ',' + point[1].toFixed(2);
			}).join(' ');
		}).join(' ');
	}

	function renderGrid(timestamps, bounds, domain) {
		chartGrid.replaceChildren();
		for (var tick = 0; tick < 5; tick += 1) {
			var ratio = tick / 4;
			var y = CHART.top + ratio * CHART.height;
			var value = domain.maximum - ratio * (domain.maximum - domain.minimum);
			chartGrid.appendChild(svgElement('line', { x1: CHART.left, y1: y, x2: CHART.right, y2: y, class: 'plan-chart-gridline' }));
			chartGrid.appendChild(svgElement('text', { x: CHART.left - 9, y: y + 4, class: 'plan-chart-axis-label', 'text-anchor': 'end' }, metricAxisValue(activeMetric, value)));
		}
		for (var timeTick = 0; timeTick < 5; timeTick += 1) {
			var timeRatio = timeTick / 4;
			var index = Math.round(bounds.start + timeRatio * (bounds.end - bounds.start));
			var x = CHART.left + timeRatio * CHART.width;
			chartGrid.appendChild(svgElement('text', { x: x, y: 329, class: 'plan-chart-axis-label', 'text-anchor': timeTick === 0 ? 'start' : timeTick === 4 ? 'end' : 'middle' }, activeRange === '6h' || (bounds.end - bounds.start) * RANGE_CONFIG[activeRange].bucket <= 86400000 ? shortTimeFormatter.format(new Date(timestamps[index])) : compactTimeFormatter.format(new Date(timestamps[index]))));
		}
	}

	function renderLegend(series) {
		chartLegend.replaceChildren();
		series.forEach(function (item) {
			var legend = document.createElement('span');
			legend.setAttribute('role', 'listitem');
			var dot = document.createElement('i');
			dot.style.backgroundColor = item.color;
			legend.append(dot, document.createTextNode(item.label + (item.fresh === false ? ' · 延迟' : '')));
			chartLegend.appendChild(legend);
		});
	}

	function summaryFor(values, bounds) {
		var numeric = [];
		for (var index = bounds.start; index <= bounds.end; index += 1) if (values[index] !== null) numeric.push(values[index]);
		if (!numeric.length) return null;
		return {
			last: numeric[numeric.length - 1],
			average: numeric.reduce(function (sum, value) { return sum + value; }, 0) / numeric.length,
			minimum: Math.min.apply(null, numeric), maximum: Math.max.apply(null, numeric), samples: numeric.length
		};
	}

	function renderStats(series, bounds, timestamps) {
		statBody.replaceChildren();
		var pointTimestamp = focusIndex === null ? null : timestamps[focusIndex];
		statPointLabel.textContent = pointTimestamp === null ? '末值' : shortTimeFormatter.format(new Date(pointTimestamp));
		statCaption.textContent = RANGE_CONFIG[activeRange].label + (zoomStart === null ? '' : ' · 已选区间') + '统计';
		series.forEach(function (item) {
			var summary = summaryFor(item.values, bounds);
			var row = document.createElement('tr');
			var labelCell = document.createElement('th');
			labelCell.scope = 'row';
			var dot = document.createElement('i');
			dot.style.backgroundColor = item.color;
			labelCell.append(dot, document.createTextNode(item.label));
			row.appendChild(labelCell);
			var pointValue = focusIndex === null ? (summary && summary.last) : item.values[focusIndex];
			[pointValue, summary && summary.average, summary && summary.minimum, summary && summary.maximum].forEach(function (value) {
				var cell = document.createElement('td');
				cell.textContent = metricValue(activeMetric, value, true);
				row.appendChild(cell);
			});
			var samples = document.createElement('td');
			samples.textContent = summary ? integerFormatter.format(summary.samples) : '--';
			row.appendChild(samples);
			statBody.appendChild(row);
		});
	}

	function focusAt(index, series, bounds, timestamps, domain, showTooltip, announce) {
		focusIndex = Math.max(bounds.start, Math.min(index, bounds.end));
		var ratio = (focusIndex - bounds.start) / Math.max(1, bounds.end - bounds.start);
		var x = CHART.left + ratio * CHART.width;
		chartCrosshair.setAttribute('x1', x.toFixed(2));
		chartCrosshair.setAttribute('x2', x.toFixed(2));
		chartCrosshair.classList.remove('is-hidden');
		chartFocus.replaceChildren();
		series.forEach(function (item) {
			var value = item.values[focusIndex];
			if (value === null) return;
			var y = CHART.top + (1 - (value - domain.minimum) / (domain.maximum - domain.minimum)) * CHART.height;
			chartFocus.appendChild(svgElement('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: 4, fill: item.color, class: 'plan-chart-focus-point' }));
		});
		if (showTooltip) {
			chartTooltip.replaceChildren();
			var time = document.createElement('time');
			time.dateTime = new Date(timestamps[focusIndex]).toISOString();
			time.textContent = dateFormatter.format(new Date(timestamps[focusIndex]));
			chartTooltip.appendChild(time);
			series.forEach(function (item) {
				var line = document.createElement('span');
				var dot = document.createElement('i');
				dot.style.backgroundColor = item.color;
				line.append(dot, document.createTextNode(item.label + ' '), document.createElement('b'));
				line.lastChild.textContent = metricValue(activeMetric, item.values[focusIndex], true);
				chartTooltip.appendChild(line);
			});
			chartTooltip.style.left = Math.max(15, Math.min(85, x / 760 * 100)) + '%';
			chartTooltip.hidden = false;
		}
		if (announce && chartLiveStatus) {
			chartLiveStatus.textContent = dateFormatter.format(new Date(timestamps[focusIndex])) + '，' + series.map(function (item) {
				return item.label + ' ' + metricValue(activeMetric, item.values[focusIndex], true);
			}).join('；');
		}
		renderStats(series, bounds, timestamps);
	}

	function clearFocus(series, bounds, timestamps) {
		focusIndex = null;
		chartCrosshair.classList.add('is-hidden');
		chartFocus.replaceChildren();
		chartTooltip.hidden = true;
		renderStats(series, bounds, timestamps);
	}

	function renderPerformanceChart() {
		if (!performanceData || !chartSvg) return;
		var timestamps = performanceData.ranges[activeRange].timestamps;
		var series = activeSeries();
		var bounds = chartBounds(timestamps.length);
		var domain = chartDomain(series, bounds);
		dragStartX = null;
		dragCurrentX = null;
		chartSelection.classList.add('is-hidden');
		chartSvg.onpointermove = null;
		chartSvg.onpointerleave = null;
		chartSvg.onlostpointercapture = function () {
			dragStartX = null;
			dragCurrentX = null;
			chartSelection.classList.add('is-hidden');
		};
		chartScope.textContent = CATEGORIES[activeCategory].label;
		chartTitle.textContent = METRICS[activeMetric].label;
		chartWindow.textContent = RANGE_CONFIG[activeRange].label + (zoomStart === null ? '' : ' · 自定义区间');
		resetButton.disabled = zoomStart === null;
		chartStage.classList.remove('is-loading');
		chartStage.classList.toggle('is-empty', !domain);
		chartEmpty.hidden = Boolean(domain);
		chartEmpty.textContent = domain ? '' : '此区间暂无数据';
		chartLines.replaceChildren();
		chartGrid.replaceChildren();
		chartFocus.replaceChildren();
		chartCrosshair.classList.add('is-hidden');
		chartTooltip.hidden = true;
		focusIndex = null;
		renderLegend(series);
		if (!domain) {
			var emptyRow = document.createElement('tr');
			var emptyCell = document.createElement('td');
			emptyCell.colSpan = 6;
			emptyCell.textContent = '此区间暂无数据';
			emptyRow.appendChild(emptyCell);
			statBody.replaceChildren(emptyRow);
			return;
		}
		renderGrid(timestamps, bounds, domain);
		series.forEach(function (item) {
			var path = svgElement('path', { d: pathForValues(item.values, bounds, domain), stroke: item.color, class: 'plan-chart-series' });
			chartLines.appendChild(path);
		});
		renderStats(series, bounds, timestamps);
		var missing = series.some(function (item) { return item.values.slice(bounds.start, bounds.end + 1).some(function (value) { return value === null; }); });
		chartDescription.textContent = CATEGORIES[activeCategory].label + '，' + METRICS[activeMetric].label + '，' + RANGE_CONFIG[activeRange].label + '趋势，显示 ' + series.map(function (item) { return item.label; }).join('、') + (missing ? '，部分时段无数据。' : '。') + ' 可使用左右方向键检查时间点。';

		chartSvg.onpointermove = function (event) {
			var x = eventChartX(event);
			if (dragStartX !== null) {
				dragCurrentX = Math.max(CHART.left, Math.min(CHART.right, x));
				var left = Math.min(dragStartX, dragCurrentX);
				chartSelection.setAttribute('x', left.toFixed(2));
				chartSelection.setAttribute('width', Math.abs(dragCurrentX - dragStartX).toFixed(2));
				chartSelection.classList.remove('is-hidden');
				return;
			}
			if (x < CHART.left || x > CHART.right) return;
			var index = Math.round(bounds.start + (x - CHART.left) / CHART.width * (bounds.end - bounds.start));
			focusAt(index, series, bounds, timestamps, domain, true, false);
		};
		chartSvg.onpointerleave = function () {
			if (dragStartX === null) clearFocus(series, bounds, timestamps);
		};
	}

	function eventChartX(event) {
		var rectangle = chartSvg.getBoundingClientRect();
		return (event.clientX - rectangle.left) / Math.max(1, rectangle.width) * 760;
	}

	function resetZoom(render) {
		zoomStart = null;
		zoomEnd = null;
		focusIndex = null;
		if (render !== false) renderPerformanceChart();
	}

	function renderSnapshot() {
		if (!performanceData || !snapshotBody) return;
		snapshotBody.replaceChildren();
		var network = performanceData.network.current;
		var livePlayers = currentOnlineValue();
		var networkRow = document.createElement('tr');
		var networkValues = [
			['群组', true],
			[network.reporting_nodes === 3 ? '完整' : network.reporting_nodes + '/3 上报'],
			[metricValue('players', livePlayers === null ? network.players : livePlayers, true)],
			[metricValue('tps_min', network.tps_min, false)],
			[metricValue('cpu_max', network.cpu_max, true)],
			[metricValue('memory_total_mb', network.memory_total_mb, true)],
			['-- / ' + metricValue('mspt_p95_max', network.mspt_p95_max, true)],
			['不聚合'],
			[metricValue('entities_total', network.entities_total, false)],
			[metricValue('chunks_total', network.chunks_total, false)],
			['不聚合']
		];
		appendSnapshotCells(networkRow, networkValues);
		snapshotBody.appendChild(networkRow);
		performanceData.nodes.forEach(function (node) {
			var current = node.current;
			var row = document.createElement('tr');
			appendSnapshotCells(row, [
				[node.label, true], [node.fresh ? '上报中' : '数据延迟'], [metricValue('players', current.players, true)],
				[metricValue('tps', current.tps, false)], [metricValue('cpu', current.cpu, true)], [metricValue('memory_mb', current.memory_mb, true)],
				[metricValue('mspt_average', current.mspt_average, true) + ' / ' + metricValue('mspt_p95', current.mspt_p95, true)],
				[metricValue('ping_average', current.ping_average, true) + '（' + metricValue('ping_min', current.ping_min, false) + '–' + metricValue('ping_max', current.ping_max, false) + '）'],
				[metricValue('entities', current.entities, false)], [metricValue('chunks', current.chunks, false)], [metricValue('disk_mb', current.disk_mb, true)]
			]);
			snapshotBody.appendChild(row);
		});
	}

	function appendSnapshotCells(row, values) {
		values.forEach(function (entry, index) {
			var cell = document.createElement(index === 0 ? 'th' : 'td');
			if (index === 0) cell.scope = 'row';
			cell.textContent = entry[0];
			row.appendChild(cell);
		});
	}

	function renderPerformance(data, stale) {
		performanceData = data;
		hasPerformanceData = true;
		body.classList.add('has-plan-charts');
		if (chartStatus) chartStatus.textContent = stale ? '缓存数据' : Math.round(data.refresh_seconds / 60) + ' 分钟同步';
		renderControlPickers();
		renderPerformanceChart();
		renderSnapshot();
	}

	function renderPerformanceFailure() {
		if (chartStatus) chartStatus.textContent = hasPerformanceData ? '更新延迟' : '暂不可用';
		if (hasPerformanceData) {
			if (chartDescription.textContent.indexOf('当前更新延迟') === -1) chartDescription.textContent = chartDescription.textContent.replace(/。$/, '') + '；当前更新延迟。';
			return;
		}
		chartStage.classList.remove('is-loading');
		chartStage.classList.add('is-empty');
		chartEmpty.textContent = '性能数据暂不可用';
		chartEmpty.hidden = false;
		chartDescription.textContent = '服务器性能数据暂不可用。';
	}

	async function requestJson(url, timeoutMs) {
		var controller = typeof AbortController === 'function' ? new AbortController() : null;
		var timeout;
		var timeoutPromise = new Promise(function (_resolve, reject) {
			timeout = setTimeout(function () {
				if (controller) controller.abort();
				reject(new Error('PLAN request timed out'));
			}, timeoutMs || REQUEST_TIMEOUT_MS);
		});
		try {
			var request = fetch(url, { cache: 'default', credentials: 'same-origin', signal: controller ? controller.signal : undefined, headers: { Accept: 'application/json' } }).then(async function (response) {
				if (!response.ok) {
					var requestError = new Error('HTTP ' + response.status);
					requestError.status = response.status;
					requestError.retryAfter = Number(response.headers.get('retry-after')) || 0;
					throw requestError;
				}
				if ((response.headers.get('content-type') || '').indexOf('application/json') === -1) throw new Error('Unexpected response type');
				return { data: await response.json(), stale: response.headers.get('x-plan-data-stale') === '1' };
			});
			return await Promise.race([request, timeoutPromise]);
		} finally {
			clearTimeout(timeout);
		}
	}

	function validateOverviewPayload(data) {
		return data && typeof data === 'object' && data.numbers && data.players && validTimestamp(finiteNumber(data.timestamp)) && finiteNumber(data.numbers.online_players) !== null;
	}

	function setOverviewLoading(loading) {
		overviewPending = loading;
		body.classList.toggle(hasOverviewData ? 'is-refreshing' : 'is-loading', loading);
		if (refreshButton) refreshButton.disabled = loading;
		if (loading && statusLabel) statusLabel.textContent = hasOverviewData ? '同步中' : '连接中';
	}

	function renderOverviewSuccess(data, stale) {
		renderBindings(data);
		currentOnlinePlayers = finiteNumber(data.numbers.online_players);
		currentOnlineTimestamp = finiteNumber(data.timestamp);
		hasOverviewData = true;
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
		if (performanceData) {
			if (activeCategory === 'network' && activeMetric === 'players') renderPerformanceChart();
			renderSnapshot();
		}
	}

	function renderOverviewFailure(retrying) {
		body.classList.remove('is-loading', 'is-refreshing', 'has-plan-stale');
		body.classList.add('has-plan-error');
		if (status) status.classList.add('is-error');
		if (statusLabel) statusLabel.textContent = retrying ? '同步中' : (hasOverviewData ? '更新延迟' : '暂不可用');
		if (errorMessage) {
			errorMessage.textContent = retrying ? '正在生成首批数据。' : (hasOverviewData ? '将在 60 秒后重试。' : '数据暂不可用。');
			errorMessage.hidden = false;
		}
	}

	function scheduleColdRetry(error) {
		if (hasOverviewData || !error || error.status !== 503 || coldRetryCount >= 3) return false;
		coldRetryCount += 1;
		var delay = Math.max(1000, Math.min((error.retryAfter || 2) * 1000, 5000));
		if (coldRetryTimer) clearTimeout(coldRetryTimer);
		coldRetryTimer = setTimeout(fetchOverview, delay);
		return true;
	}

	async function fetchOverview() {
		if (overviewPending || document.hidden) return;
		setOverviewLoading(true);
		try {
			var result = await requestJson(OVERVIEW_URL);
			if (!validateOverviewPayload(result.data)) throw new Error('Invalid PLAN overview payload');
			renderOverviewSuccess(result.data, result.stale);
		} catch (error) {
			renderOverviewFailure(scheduleColdRetry(error));
		} finally {
			setOverviewLoading(false);
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
			var result = await requestJson(PERFORMANCE_URL, PERFORMANCE_REQUEST_TIMEOUT_MS);
			if (!validatePerformancePayload(result.data)) throw new Error('Invalid PLAN performance payload');
			renderPerformance(result.data, result.stale);
			lastPerformanceFetch = result.stale ? Date.now() - PERFORMANCE_REFRESH_MS + 60000 : Date.now();
		} catch (_error) {
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

	document.querySelectorAll('[data-plan-range]').forEach(function (button) {
		button.addEventListener('click', function () {
			activeRange = button.getAttribute('data-plan-range');
			document.querySelectorAll('[data-plan-range]').forEach(function (candidate) {
				var active = candidate === button;
				candidate.classList.toggle('is-active', active);
				candidate.setAttribute('aria-pressed', active ? 'true' : 'false');
			});
			resetZoom(false);
			renderPerformanceChart();
		});
	});
	if (resetButton) resetButton.addEventListener('click', function () { resetZoom(true); });
	if (chartSvg) {
		chartSvg.addEventListener('pointerdown', function (event) {
			var x = eventChartX(event);
			if (x < CHART.left || x > CHART.right || !performanceData) return;
			dragStartX = x;
			dragCurrentX = x;
			chartSvg.setPointerCapture(event.pointerId);
		});
		chartSvg.addEventListener('pointerup', function (event) {
			if (dragStartX === null || !performanceData) return;
			var endX = Math.max(CHART.left, Math.min(CHART.right, eventChartX(event)));
			var distance = Math.abs(endX - dragStartX);
			chartSelection.classList.add('is-hidden');
			if (distance >= 18) {
				var pointCount = performanceData.ranges[activeRange].timestamps.length;
				var bounds = chartBounds(pointCount);
				var leftX = Math.min(dragStartX, endX);
				var rightX = Math.max(dragStartX, endX);
				var selectedStart = Math.round(bounds.start + (leftX - CHART.left) / CHART.width * (bounds.end - bounds.start));
				var selectedEnd = Math.round(bounds.start + (rightX - CHART.left) / CHART.width * (bounds.end - bounds.start));
				if (selectedEnd - selectedStart >= 2) {
					zoomStart = selectedStart;
					zoomEnd = selectedEnd;
				}
			}
			dragStartX = null;
			dragCurrentX = null;
			renderPerformanceChart();
		});
		chartSvg.addEventListener('pointercancel', function () {
			dragStartX = null;
			dragCurrentX = null;
			chartSelection.classList.add('is-hidden');
		});
		chartSvg.addEventListener('dblclick', function () { resetZoom(true); });
		chartSvg.addEventListener('keydown', function (event) {
			if (!performanceData || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
			event.preventDefault();
			var timestamps = performanceData.ranges[activeRange].timestamps;
			var series = activeSeries();
			var bounds = chartBounds(timestamps.length);
			var domain = chartDomain(series, bounds);
			if (!domain) return;
			var next = focusIndex === null ? bounds.end : focusIndex + (event.key === 'ArrowLeft' ? -1 : 1);
			focusAt(next, series, bounds, timestamps, domain, true, true);
		});
	}
	if (refreshButton) refreshButton.addEventListener('click', function () { refreshAll(true); });
	document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshAll(false); });
	window.addEventListener('online', function () { refreshAll(true); });

	renderControlPickers();
	refreshAll(true);
	setInterval(function () { refreshAll(false); }, OVERVIEW_REFRESH_MS);
})();
