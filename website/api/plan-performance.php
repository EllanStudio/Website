<?php
declare(strict_types=1);

const PLAN_BASE_URL = 'http://43.249.195.103:16884';
const PLAN_NODES = [
    'redstone' => [
        'label' => '红石服',
        'source' => 'Redstone',
        'uuid' => '556cecc2-25db-4a5c-b885-9a417384adde',
        'color' => '#f5be4f',
    ],
    'spawn' => [
        'label' => '主城服',
        'source' => 'Spawn',
        'uuid' => '57e23905-8bd4-4389-bf7c-3b983c5e5411',
        'color' => '#5ed6c4',
    ],
    'survival' => [
        'label' => '生存服',
        'source' => 'Survival',
        'uuid' => '9354d4b2-d4a4-4358-9fa1-3771fe3170c7',
        'color' => '#8fdd55',
    ],
];
const RANGE_CONFIG = [
    '6h' => ['label' => '6 小时', 'window_ms' => 21600000, 'bucket_ms' => 120000],
    '24h' => ['label' => '24 小时', 'window_ms' => 86400000, 'bucket_ms' => 600000],
    '7d' => ['label' => '7 天', 'window_ms' => 604800000, 'bucket_ms' => 3600000],
    '30d' => ['label' => '30 天', 'window_ms' => 2592000000, 'bucket_ms' => 21600000],
];
const PERFORMANCE_METRICS = [
    'players' => ['source' => 'playersOnline', 'minimum' => 0, 'maximum' => 1000000, 'precision' => 1, 'mode' => 'average'],
    'tps' => ['source' => 'tps', 'minimum' => 0, 'maximum' => 21, 'precision' => 2, 'mode' => 'minimum'],
    'cpu' => ['source' => 'cpu', 'minimum' => 0, 'maximum' => 100, 'precision' => 1, 'mode' => 'average'],
    'memory_mb' => ['source' => 'ram', 'minimum' => 0, 'maximum' => 1000000, 'precision' => 0, 'mode' => 'average'],
    'entities' => ['source' => 'entities', 'minimum' => 0, 'maximum' => 100000000, 'precision' => 0, 'mode' => 'average'],
    'chunks' => ['source' => 'chunks', 'minimum' => 0, 'maximum' => 100000000, 'precision' => 0, 'mode' => 'average'],
    'disk_mb' => ['source' => 'disk', 'minimum' => 0, 'maximum' => 1000000000, 'precision' => 0, 'mode' => 'average'],
    'mspt_average' => ['source' => 'msptAverage', 'minimum' => 0, 'maximum' => 1000000, 'precision' => 2, 'mode' => 'average'],
    'mspt_p95' => ['source' => 'mspt95thPercentile', 'minimum' => 0, 'maximum' => 1000000, 'precision' => 2, 'mode' => 'maximum'],
];
const PING_METRICS = [
    'ping_min' => ['source' => 'min_ping_series', 'minimum' => 0, 'maximum' => 1000000, 'precision' => 1, 'mode' => 'minimum'],
    'ping_average' => ['source' => 'avg_ping_series', 'minimum' => 0, 'maximum' => 1000000, 'precision' => 1, 'mode' => 'average'],
    'ping_max' => ['source' => 'max_ping_series', 'minimum' => 0, 'maximum' => 1000000, 'precision' => 1, 'mode' => 'maximum'],
];
const NETWORK_METRICS = [
    'players' => ['minimum' => 0, 'maximum' => 1000000],
    'cpu_max' => ['minimum' => 0, 'maximum' => 100],
    'memory_total_mb' => ['minimum' => 0, 'maximum' => 3000000],
    'entities_total' => ['minimum' => 0, 'maximum' => 300000000],
    'chunks_total' => ['minimum' => 0, 'maximum' => 300000000],
    'tps_min' => ['minimum' => 0, 'maximum' => 21],
    'mspt_p95_max' => ['minimum' => 0, 'maximum' => 1000000],
    'reporting_nodes' => ['minimum' => 0, 'maximum' => 3],
];
const MAX_PERFORMANCE_BYTES = 4718592;
const MAX_GRAPH_BYTES = 1572864;
const MAX_UPSTREAM_TOTAL_BYTES = 20971520;
const MAX_CACHE_BYTES = 4194304;
const MAX_KEYS = 10;
const MAX_ROWS = 45000;
const MAX_GRAPHS = 8;
const MAX_POINTS_PER_GRAPH = 45000;
const MAX_PING_POINTS_TOTAL = 80000;
const MAX_POINTS_TOTAL = 80000;
const MIN_TIMESTAMP_MS = 1577836800000;
const CACHE_TTL_SECONDS = 300;
const STALE_TTL_SECONDS = 1800;
const FAILURE_RETRY_SECONDS = 60;
const FRESH_NODE_MS = 900000;

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');

function respondWithError(int $status, string $message): void
{
    http_response_code($status);
    header('Cache-Control: no-store');
    echo json_encode(['error' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function respondWithJson(string $json, bool $stale = false): void
{
    header($stale
        ? 'Cache-Control: public, max-age=15, s-maxage=15, stale-if-error=1800'
        : 'Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=60, stale-if-error=1800');
    if ($stale) {
        header('Warning: 110 - "Response is stale"');
        header('X-Plan-Data-Stale: 1');
    }
    $etag = '"' . hash('sha256', $json) . '"';
    header('ETag: ' . $etag);
    if (!$stale && trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit;
    }
    echo $json;
    exit;
}

function boundedNumber($value, float $minimum, float $maximum)
{
    if (!is_numeric($value)) {
        return null;
    }
    $number = $value + 0;
    if (!is_finite((float) $number) || $number < $minimum || $number > $maximum) {
        return null;
    }
    return $number;
}

function roundedNumber(float $value, int $precision)
{
    $rounded = round($value, $precision);
    return $precision === 0 ? (int) $rounded : $rounded;
}

function sameKeys(array $source, array $expected): bool
{
    $actual = array_keys($source);
    sort($actual);
    sort($expected);
    return $actual === $expected;
}

function rangeMetadata(int $now): array
{
    $ranges = [];
    foreach (RANGE_CONFIG as $id => $config) {
        $end = intdiv($now, $config['bucket_ms']) * $config['bucket_ms'];
        $start = $end - $config['window_ms'];
        $timestamps = [];
        for ($timestamp = $start; $timestamp <= $end; $timestamp += $config['bucket_ms']) {
            $timestamps[] = $timestamp;
        }
        $ranges[$id] = [
            'label' => $config['label'],
            'window_ms' => $config['window_ms'],
            'bucket_ms' => $config['bucket_ms'],
            'timestamps' => $timestamps,
        ];
    }
    return $ranges;
}

function performanceData(string $json, array $ranges, int $now): ?array
{
    $payload = json_decode($json, true, 16);
    if (!is_array($payload)
        || !isset($payload['keys'], $payload['values'])
        || !is_array($payload['keys'])
        || !is_array($payload['values'])
        || count($payload['keys']) !== count(PERFORMANCE_METRICS) + 1
        || count($payload['keys']) > MAX_KEYS
        || count($payload['values']) < 2
        || count($payload['values']) > MAX_ROWS) {
        return null;
    }

    foreach ($payload['keys'] as $key) {
        if (!is_string($key) || $key === '') {
            return null;
        }
    }
    $indexes = array_flip($payload['keys']);
    if (count($indexes) !== count($payload['keys']) || !isset($indexes['date'])) {
        return null;
    }
    foreach (PERFORMANCE_METRICS as $definition) {
        if (!isset($indexes[$definition['source']])) {
            return null;
        }
    }

    $earliest = $now - RANGE_CONFIG['30d']['window_ms'];
    $maximumTimestamp = $now + 60000;
    $buckets = array_fill_keys(array_keys($ranges), []);
    $latestTimestamp = 0;
    $current = array_fill_keys(array_keys(PERFORMANCE_METRICS), null);
    $currentTimestamps = array_fill_keys(array_keys(PERFORMANCE_METRICS), 0);

    foreach ($payload['values'] as $row) {
        if (!is_array($row) || count($row) !== count($payload['keys'])) {
            return null;
        }
        $timestamp = boundedNumber($row[$indexes['date']] ?? null, $earliest, $maximumTimestamp);
        if ($timestamp === null || $timestamp > $now) {
            continue;
        }
        $timestamp = (int) $timestamp;
        $latestTimestamp = max($latestTimestamp, $timestamp);
        foreach (PERFORMANCE_METRICS as $metric => $definition) {
            $value = boundedNumber(
                $row[$indexes[$definition['source']]] ?? null,
                $definition['minimum'],
                $definition['maximum']
            );
            if ($value === null) {
                continue;
            }
            $value = (float) $value;
            if ($timestamp >= $currentTimestamps[$metric]) {
                $currentTimestamps[$metric] = $timestamp;
                $current[$metric] = roundedNumber($value, $definition['precision']);
            }
            foreach ($ranges as $range => $metadata) {
                $start = max($metadata['timestamps'][0], $now - RANGE_CONFIG[$range]['window_ms']);
                $end = $metadata['timestamps'][count($metadata['timestamps']) - 1];
                if ($timestamp < $start || $timestamp > $now) {
                    continue;
                }
                $bucket = intdiv($timestamp, $metadata['bucket_ms']) * $metadata['bucket_ms'];
                if ($bucket < $metadata['timestamps'][0] || $bucket > $end) {
                    continue;
                }
                if (!isset($buckets[$range][$bucket])) {
                    $buckets[$range][$bucket] = ['metrics' => []];
                }
                if (!isset($buckets[$range][$bucket]['metrics'][$metric])) {
                    $buckets[$range][$bucket]['metrics'][$metric] = [
                        'count' => 0,
                        'sum' => 0.0,
                        'minimum' => $value,
                        'maximum' => $value,
                    ];
                }
                $metricBucket = &$buckets[$range][$bucket]['metrics'][$metric];
                $metricBucket['count']++;
                $metricBucket['sum'] += $value;
                $metricBucket['minimum'] = min($metricBucket['minimum'], $value);
                $metricBucket['maximum'] = max($metricBucket['maximum'], $value);
                unset($metricBucket);
            }
        }
    }
    unset($payload);

    if ($latestTimestamp < $earliest) {
        return null;
    }
    $series = [];
    foreach ($ranges as $range => $metadata) {
        $series[$range] = array_fill_keys(array_keys(PERFORMANCE_METRICS), []);
        foreach ($metadata['timestamps'] as $timestamp) {
            $bucket = $buckets[$range][$timestamp] ?? null;
            foreach (PERFORMANCE_METRICS as $metric => $definition) {
                $metricBucket = $bucket === null ? null : ($bucket['metrics'][$metric] ?? null);
                if ($metricBucket === null) {
                    $series[$range][$metric][] = null;
                    continue;
                }
                $value = match ($definition['mode']) {
                    'minimum' => $metricBucket['minimum'],
                    'maximum' => $metricBucket['maximum'],
                    default => $metricBucket['sum'] / $metricBucket['count'],
                };
                $series[$range][$metric][] = roundedNumber($value, $definition['precision']);
            }
        }
    }
    return [
        'timestamp' => $latestTimestamp,
        'fresh' => $latestTimestamp >= $now - FRESH_NODE_MS,
        'current' => $current,
        'series' => $series,
    ];
}

function pingData(string $json, array $ranges, int $now): ?array
{
    $payload = json_decode($json, true, 16);
    if (!is_array($payload)) {
        return null;
    }
    $earliest = $now - RANGE_CONFIG['30d']['window_ms'];
    $maximumTimestamp = $now + 60000;
    $totalPoints = 0;
    $series = [];
    foreach ($ranges as $range => $metadata) {
        $series[$range] = array_fill_keys(array_keys(PING_METRICS), []);
    }
    $latestTimestamp = 0;
    $current = array_fill_keys(array_keys(PING_METRICS), null);

    foreach (PING_METRICS as $metric => $definition) {
        $points = $payload[$definition['source']] ?? null;
        if (!is_array($points) || count($points) > MAX_POINTS_PER_GRAPH) {
            return null;
        }
        $totalPoints += count($points);
        if ($totalPoints > MAX_PING_POINTS_TOTAL) {
            return null;
        }
        $buckets = array_fill_keys(array_keys($ranges), []);
        $metricLatestTimestamp = 0;
        foreach ($points as $point) {
            if (!is_array($point) || count($point) !== 2) {
                return null;
            }
            $timestamp = boundedNumber($point[0] ?? null, $earliest, $maximumTimestamp);
            $value = boundedNumber($point[1] ?? null, $definition['minimum'], $definition['maximum']);
            if ($timestamp === null || $value === null || $timestamp > $now) {
                continue;
            }
            $timestamp = (int) $timestamp;
            $value = (float) $value;
            if ($timestamp > $metricLatestTimestamp) {
                $metricLatestTimestamp = $timestamp;
                $current[$metric] = roundedNumber($value, $definition['precision']);
            }
            foreach ($ranges as $range => $metadata) {
                $start = max($metadata['timestamps'][0], $now - RANGE_CONFIG[$range]['window_ms']);
                $end = $metadata['timestamps'][count($metadata['timestamps']) - 1];
                if ($timestamp < $start || $timestamp > $now) {
                    continue;
                }
                $bucketTimestamp = intdiv($timestamp, $metadata['bucket_ms']) * $metadata['bucket_ms'];
                if ($bucketTimestamp < $start || $bucketTimestamp > $end) {
                    continue;
                }
                if (!isset($buckets[$range][$bucketTimestamp])) {
                    $buckets[$range][$bucketTimestamp] = ['count' => 0, 'sum' => 0.0, 'minimum' => $value, 'maximum' => $value];
                }
                $bucket = &$buckets[$range][$bucketTimestamp];
                $bucket['count']++;
                $bucket['sum'] += $value;
                $bucket['minimum'] = min($bucket['minimum'], $value);
                $bucket['maximum'] = max($bucket['maximum'], $value);
                unset($bucket);
            }
        }
        $latestTimestamp = max($latestTimestamp, $metricLatestTimestamp);
        foreach ($ranges as $range => $metadata) {
            foreach ($metadata['timestamps'] as $timestamp) {
                $bucket = $buckets[$range][$timestamp] ?? null;
                if ($bucket === null) {
                    $series[$range][$metric][] = null;
                    continue;
                }
                if ($definition['mode'] === 'minimum') {
                    $value = $bucket['minimum'];
                } elseif ($definition['mode'] === 'maximum') {
                    $value = $bucket['maximum'];
                } else {
                    $value = $bucket['sum'] / $bucket['count'];
                }
                $series[$range][$metric][] = roundedNumber($value, $definition['precision']);
            }
        }
    }
    $commonIndex = null;
    for ($index = count($ranges['6h']['timestamps']) - 1; $index >= 0; $index--) {
        $complete = true;
        foreach (PING_METRICS as $metric => $_definition) {
            if ($series['6h'][$metric][$index] === null) {
                $complete = false;
                break;
            }
        }
        if ($complete) {
            $commonIndex = $index;
            break;
        }
    }
    if ($commonIndex !== null) {
        foreach (PING_METRICS as $metric => $_definition) {
            $current[$metric] = $series['6h'][$metric][$commonIndex];
        }
        $latestTimestamp = $ranges['6h']['timestamps'][$commonIndex];
    } else {
        $current = array_fill_keys(array_keys(PING_METRICS), null);
    }
    return [
        'timestamp' => $latestTimestamp,
        'fresh' => $commonIndex !== null && $latestTimestamp >= $now - FRESH_NODE_MS,
        'current' => $current,
        'series' => $series,
    ];
}

function playerData(string $json, array $ranges, int $now): ?array
{
    $payload = json_decode($json, true, 16);
    if (!is_array($payload) || !isset($payload['graphs']) || !is_array($payload['graphs'])
        || count($payload['graphs']) < 1 || count($payload['graphs']) > MAX_GRAPHS) {
        return null;
    }
    $earliest = $now - RANGE_CONFIG['30d']['window_ms'];
    $maximumTimestamp = $now + 60000;
    $graphSeries = [];
    $totalPoints = 0;
    $latestRawTimestamp = 0;

    foreach ($payload['graphs'] as $graph) {
        $points = is_array($graph) ? ($graph['points'] ?? null) : null;
        if (!is_array($points) || count($points) < 2 || count($points) > MAX_POINTS_PER_GRAPH) {
            return null;
        }
        $totalPoints += count($points);
        if ($totalPoints > MAX_POINTS_TOTAL) {
            return null;
        }
        $buckets = array_fill_keys(array_keys($ranges), []);
        foreach ($points as $point) {
            if (!is_array($point) || count($point) !== 2) {
                return null;
            }
            $timestamp = boundedNumber($point[0] ?? null, $earliest, $maximumTimestamp);
            $players = boundedNumber($point[1] ?? null, 0, 1000000);
            if ($timestamp === null || $players === null || $timestamp > $now) {
                continue;
            }
            $timestamp = (int) $timestamp;
            $latestRawTimestamp = max($latestRawTimestamp, $timestamp);
            foreach ($ranges as $range => $metadata) {
                $start = max($metadata['timestamps'][0], $now - RANGE_CONFIG[$range]['window_ms']);
                $end = $metadata['timestamps'][count($metadata['timestamps']) - 1];
                if ($timestamp < $start || $timestamp > $now) {
                    continue;
                }
                $bucketTimestamp = intdiv($timestamp, $metadata['bucket_ms']) * $metadata['bucket_ms'];
                if ($bucketTimestamp < $start || $bucketTimestamp > $end) {
                    continue;
                }
                if (!isset($buckets[$range][$bucketTimestamp])) {
                    $buckets[$range][$bucketTimestamp] = ['count' => 0, 'sum' => 0.0];
                }
                $buckets[$range][$bucketTimestamp]['count']++;
                $buckets[$range][$bucketTimestamp]['sum'] += $players;
            }
        }
        $oneGraphSeries = [];
        foreach ($ranges as $range => $metadata) {
            $oneGraphSeries[$range] = [];
            foreach ($metadata['timestamps'] as $timestamp) {
                $bucket = $buckets[$range][$timestamp] ?? null;
                $oneGraphSeries[$range][] = $bucket === null ? null : round($bucket['sum'] / $bucket['count'], 1);
            }
        }
        $graphSeries[] = $oneGraphSeries;
    }
    unset($payload);

    $series = [];
    foreach ($ranges as $range => $metadata) {
        $series[$range] = [];
        foreach ($metadata['timestamps'] as $index => $_timestamp) {
            $players = 0.0;
            foreach ($graphSeries as $graph) {
                $value = $graph[$range][$index];
                if ($value === null) {
                    $players = null;
                    break;
                }
                $players += $value;
            }
            $series[$range][] = $players === null ? null : round($players, 1);
        }
    }
    $current = null;
    for ($index = count($series['6h']) - 1; $index >= 0; $index--) {
        if ($series['6h'][$index] !== null) {
            $current = (int) round($series['6h'][$index]);
            break;
        }
    }
    return $current === null ? null : [
        'timestamp' => $latestRawTimestamp,
        'fresh' => $latestRawTimestamp >= $now - FRESH_NODE_MS,
        'current' => $current,
        'series' => $series,
    ];
}

function aggregateNodeValues(array $nodes, string $metric, string $mode, int $precision): array
{
    $ranges = [];
    foreach (RANGE_CONFIG as $range => $_config) {
        $pointCount = count($nodes[0]['series'][$range][$metric]);
        $ranges[$range] = [];
        for ($index = 0; $index < $pointCount; $index++) {
            $values = [];
            foreach ($nodes as $node) {
                $value = $node['series'][$range][$metric][$index];
                if ($value !== null) {
                    $values[] = $value;
                }
            }
            if ($values === [] || ($mode === 'sum' && count($values) !== count($nodes))) {
                $ranges[$range][] = null;
            } elseif ($mode === 'minimum') {
                $ranges[$range][] = roundedNumber((float) min($values), $precision);
            } elseif ($mode === 'maximum') {
                $ranges[$range][] = roundedNumber((float) max($values), $precision);
            } else {
                $ranges[$range][] = roundedNumber((float) array_sum($values), $precision);
            }
        }
    }
    return $ranges;
}

function buildNetwork(array $nodes, array $players, array $ranges, int $now): array
{
    $networkSeries = [];
    foreach (RANGE_CONFIG as $range => $_config) {
        $networkSeries[$range] = [
            'players' => $players['series'][$range],
            'cpu_max' => [],
            'memory_total_mb' => [],
            'entities_total' => [],
            'chunks_total' => [],
            'tps_min' => [],
            'mspt_p95_max' => [],
            'reporting_nodes' => [],
        ];
    }
    $aggregateDefinitions = [
        'cpu_max' => ['source' => 'cpu', 'mode' => 'maximum', 'precision' => 1],
        'memory_total_mb' => ['source' => 'memory_mb', 'mode' => 'sum', 'precision' => 0],
        'entities_total' => ['source' => 'entities', 'mode' => 'sum', 'precision' => 0],
        'chunks_total' => ['source' => 'chunks', 'mode' => 'sum', 'precision' => 0],
        'tps_min' => ['source' => 'tps', 'mode' => 'minimum', 'precision' => 2],
        'mspt_p95_max' => ['source' => 'mspt_p95', 'mode' => 'maximum', 'precision' => 2],
    ];
    foreach ($aggregateDefinitions as $target => $definition) {
        $valuesByRange = aggregateNodeValues($nodes, $definition['source'], $definition['mode'], $definition['precision']);
        foreach ($valuesByRange as $range => $values) {
            $networkSeries[$range][$target] = $values;
        }
    }
    foreach (RANGE_CONFIG as $range => $_config) {
        $pointCount = count($nodes[0]['series'][$range]['cpu']);
        for ($index = 0; $index < $pointCount; $index++) {
            $reporting = 0;
            foreach ($nodes as $node) {
                if ($node['series'][$range]['cpu'][$index] !== null) {
                    $reporting++;
                }
            }
            $networkSeries[$range]['reporting_nodes'][] = $reporting;
        }
    }

    $lastIndex = count($nodes[0]['series']['6h']['cpu']) - 1;
    $commonIndex = null;
    for ($index = $lastIndex; $index >= 0; $index--) {
        $complete = true;
        foreach ($nodes as $node) {
            if (!$node['fresh']) {
                $complete = false;
                break;
            }
            foreach (['cpu', 'memory_mb', 'entities', 'chunks', 'tps', 'mspt_p95'] as $metric) {
                if ($node['series']['6h'][$metric][$index] === null) {
                    $complete = false;
                    break 2;
                }
            }
        }
        if ($complete) {
            $commonIndex = $index;
            break;
        }
    }
    $lastIndex = $commonIndex ?? -1;
    if ($commonIndex !== null && $ranges['6h']['timestamps'][$commonIndex] < $now - FRESH_NODE_MS) {
        $commonIndex = null;
        $lastIndex = -1;
    }
    $currentNodes = $commonIndex === null ? [] : $nodes;
    $current = [
        'players' => $commonIndex !== null && $players['fresh'] ? ($players['series']['6h'][$commonIndex] ?? null) : null,
        'cpu_max' => null,
        'memory_total_mb' => 0,
        'entities_total' => 0,
        'chunks_total' => 0,
        'tps_min' => null,
        'mspt_p95_max' => null,
        'reporting_nodes' => count($currentNodes),
    ];
    foreach ($currentNodes as $node) {
        $current['cpu_max'] = $current['cpu_max'] === null ? $node['series']['6h']['cpu'][$lastIndex] : max($current['cpu_max'], $node['series']['6h']['cpu'][$lastIndex]);
        $current['memory_total_mb'] += $node['series']['6h']['memory_mb'][$lastIndex];
        $current['entities_total'] += $node['series']['6h']['entities'][$lastIndex];
        $current['chunks_total'] += $node['series']['6h']['chunks'][$lastIndex];
        $current['tps_min'] = $current['tps_min'] === null ? $node['series']['6h']['tps'][$lastIndex] : min($current['tps_min'], $node['series']['6h']['tps'][$lastIndex]);
        $current['mspt_p95_max'] = $current['mspt_p95_max'] === null ? $node['series']['6h']['mspt_p95'][$lastIndex] : max($current['mspt_p95_max'], $node['series']['6h']['mspt_p95'][$lastIndex]);
    }
    if (count($currentNodes) === count($nodes)) {
        $current['cpu_max'] = round($current['cpu_max'], 1);
    } else {
        $current['cpu_max'] = null;
        $current['memory_total_mb'] = null;
        $current['entities_total'] = null;
        $current['chunks_total'] = null;
    }
    $nodeTimestamp = 0;
    foreach ($nodes as $node) {
        $nodeTimestamp = max($nodeTimestamp, (int) $node['timestamp']);
    }
    return ['timestamp' => $commonIndex === null ? max($nodeTimestamp, (int) $players['timestamp']) : $ranges['6h']['timestamps'][$commonIndex], 'current' => $current, 'series' => $networkSeries];
}

function buildPayload(array &$bodies): ?array
{
    $now = time() * 1000;
    $ranges = rangeMetadata($now);
    $nodes = [];
    foreach (PLAN_NODES as $id => $metadata) {
        $performanceKey = $id . ':performance';
        $pingKey = $id . ':ping';
        $performance = performanceData($bodies[$performanceKey] ?? '', $ranges, $now);
        unset($bodies[$performanceKey]);
        $ping = pingData($bodies[$pingKey] ?? '', $ranges, $now);
        unset($bodies[$pingKey]);
        if ($performance === null || $ping === null) {
            return null;
        }
        $series = [];
        foreach (RANGE_CONFIG as $range => $_config) {
            $series[$range] = array_merge($performance['series'][$range], $ping['series'][$range]);
        }
        $nodes[] = [
            'id' => $id,
            'label' => $metadata['label'],
            'source' => $metadata['source'],
            'color' => $metadata['color'],
            'timestamp' => $ping['timestamp'] > 0 ? min($performance['timestamp'], $ping['timestamp']) : $performance['timestamp'],
            'fresh' => $performance['fresh'] && $ping['fresh'],
            'current' => array_merge($performance['current'], $ping['current']),
            'series' => $series,
        ];
    }
    $players = playerData($bodies['players'] ?? '', $ranges, $now);
    unset($bodies['players']);
    if ($players === null) {
        return null;
    }
    return [
        'timestamp' => $now,
        'refresh_seconds' => CACHE_TTL_SECONDS,
        'ranges' => $ranges,
        'nodes' => $nodes,
        'network' => buildNetwork($nodes, $players, $ranges, $now),
    ];
}

function validNullableNumber($value, float $minimum, float $maximum): bool
{
    return $value === null || boundedNumber($value, $minimum, $maximum) !== null;
}

function validValueSeries($values, int $length, float $minimum, float $maximum): bool
{
    if (!is_array($values) || count($values) !== $length) {
        return false;
    }
    foreach ($values as $value) {
        if (!validNullableNumber($value, $minimum, $maximum)) {
            return false;
        }
    }
    return true;
}

function refreshCachedPayload(array $payload): array
{
    $now = time() * 1000;
    $reportingNodes = 0;
    foreach ($payload['nodes'] as &$node) {
        $timestamp = boundedNumber($node['timestamp'] ?? null, MIN_TIMESTAMP_MS, $now + 60000);
        $node['fresh'] = $timestamp !== null && $timestamp >= $now - FRESH_NODE_MS;
        if ($node['fresh']) {
            $reportingNodes++;
        }
    }
    unset($node);
    $payload['network']['current']['reporting_nodes'] = $reportingNodes;
    if ($reportingNodes !== count($payload['nodes'])) {
        $payload['network']['current']['cpu_max'] = null;
        $payload['network']['current']['memory_total_mb'] = null;
        $payload['network']['current']['entities_total'] = null;
        $payload['network']['current']['chunks_total'] = null;
        $payload['network']['current']['tps_min'] = null;
        $payload['network']['current']['mspt_p95_max'] = null;
    }
    $networkTimestamp = boundedNumber($payload['network']['timestamp'] ?? null, MIN_TIMESTAMP_MS, $now + 60000);
    if ($networkTimestamp === null || $networkTimestamp < $now - FRESH_NODE_MS) {
        $payload['network']['current']['players'] = null;
    }
    return $payload;
}

function validPayload($payload): bool
{
    if (!is_array($payload)
        || !sameKeys($payload, ['timestamp', 'refresh_seconds', 'ranges', 'nodes', 'network'])
        || boundedNumber($payload['timestamp'], MIN_TIMESTAMP_MS, (time() + 300) * 1000) === null
        || $payload['refresh_seconds'] !== CACHE_TTL_SECONDS
        || !is_array($payload['ranges'])
        || !is_array($payload['nodes'])
        || count($payload['nodes']) !== count(PLAN_NODES)
        || !is_array($payload['network'])) {
        return false;
    }
    if (!sameKeys($payload['ranges'], array_keys(RANGE_CONFIG))) {
        return false;
    }
    $rangeLengths = [];
    foreach (RANGE_CONFIG as $range => $config) {
        $metadata = $payload['ranges'][$range] ?? null;
        $expectedLength = intdiv($config['window_ms'], $config['bucket_ms']) + 1;
        if (!is_array($metadata)
            || !sameKeys($metadata, ['label', 'window_ms', 'bucket_ms', 'timestamps'])
            || $metadata['label'] !== $config['label']
            || $metadata['window_ms'] !== $config['window_ms']
            || $metadata['bucket_ms'] !== $config['bucket_ms']
            || !is_array($metadata['timestamps'])
            || count($metadata['timestamps']) !== $expectedLength) {
            return false;
        }
        $previous = null;
        foreach ($metadata['timestamps'] as $timestamp) {
            $timestamp = boundedNumber($timestamp, MIN_TIMESTAMP_MS, (time() + 300) * 1000);
            if ($timestamp === null || (int) $timestamp % $config['bucket_ms'] !== 0
                || ($previous !== null && (int) $timestamp !== $previous + $config['bucket_ms'])) {
                return false;
            }
            $previous = (int) $timestamp;
        }
        $rangeLengths[$range] = $expectedLength;
    }

    $nodeMetricDefinitions = array_merge(PERFORMANCE_METRICS, PING_METRICS);
    $expectedNodeIds = array_keys(PLAN_NODES);
    foreach ($payload['nodes'] as $index => $node) {
        $id = $expectedNodeIds[$index];
        $metadata = PLAN_NODES[$id];
        if (!is_array($node)
            || !sameKeys($node, ['id', 'label', 'source', 'color', 'timestamp', 'fresh', 'current', 'series'])
            || $node['id'] !== $id
            || $node['label'] !== $metadata['label']
            || $node['source'] !== $metadata['source']
            || $node['color'] !== $metadata['color']
            || boundedNumber($node['timestamp'], MIN_TIMESTAMP_MS, (time() + 300) * 1000) === null
            || !is_bool($node['fresh'])
            || !is_array($node['current'])
            || !sameKeys($node['current'], array_keys($nodeMetricDefinitions))
            || !is_array($node['series'])
            || !sameKeys($node['series'], array_keys(RANGE_CONFIG))) {
            return false;
        }
        foreach ($nodeMetricDefinitions as $metric => $definition) {
            if (!validNullableNumber($node['current'][$metric], $definition['minimum'], $definition['maximum'])) {
                return false;
            }
        }
        foreach (RANGE_CONFIG as $range => $_config) {
            if (!is_array($node['series'][$range])
                || !sameKeys($node['series'][$range], array_keys($nodeMetricDefinitions))) {
                return false;
            }
            foreach ($nodeMetricDefinitions as $metric => $definition) {
                if (!validValueSeries(
                    $node['series'][$range][$metric],
                    $rangeLengths[$range],
                    $definition['minimum'],
                    $definition['maximum']
                )) {
                    return false;
                }
            }
        }
    }

    $network = $payload['network'];
    if (!sameKeys($network, ['timestamp', 'current', 'series'])
        || boundedNumber($network['timestamp'], MIN_TIMESTAMP_MS, (time() + 300) * 1000) === null
        || !is_array($network['current'])
        || !sameKeys($network['current'], array_keys(NETWORK_METRICS))
        || !is_array($network['series'])
        || !sameKeys($network['series'], array_keys(RANGE_CONFIG))) {
        return false;
    }
    foreach (NETWORK_METRICS as $metric => $definition) {
        if (!validNullableNumber($network['current'][$metric], $definition['minimum'], $definition['maximum'])) {
            return false;
        }
    }
    foreach (RANGE_CONFIG as $range => $_config) {
        if (!is_array($network['series'][$range])
            || !sameKeys($network['series'][$range], array_keys(NETWORK_METRICS))) {
            return false;
        }
        foreach (NETWORK_METRICS as $metric => $definition) {
            if (!validValueSeries(
                $network['series'][$range][$metric],
                $rangeLengths[$range],
                $definition['minimum'],
                $definition['maximum']
            )) {
                return false;
            }
        }
    }
    return true;
}

function privateCacheDirectory(): ?string
{
    $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'ellan-plan-performance';
    clearstatcache(true, $directory);
    if (is_link($directory)) {
        return null;
    }
    if (!is_dir($directory) && !@mkdir($directory, 0700) && !is_dir($directory)) {
        return null;
    }
    @chmod($directory, 0700);
    clearstatcache(true, $directory);
    $permissions = @fileperms($directory);
    if (is_link($directory) || !is_dir($directory) || !is_writable($directory)
        || !is_int($permissions) || ($permissions & 0077) !== 0) {
        return null;
    }
    return $directory;
}

function cachedJson(string $path, int $maximumAge): ?string
{
    if (is_link($path)) {
        return null;
    }
    clearstatcache(true, $path);
    $modified = @filemtime($path);
    $size = @filesize($path);
    if (!is_int($modified) || !is_int($size) || $size < 1 || $size > MAX_CACHE_BYTES || time() - $modified > $maximumAge) {
        return null;
    }
    $json = @file_get_contents($path, false, null, 0, MAX_CACHE_BYTES + 1);
    if (!is_string($json) || $json === '' || strlen($json) > MAX_CACHE_BYTES) {
        return null;
    }
    $payload = json_decode($json, true);
    if (!validPayload($payload)) {
        return null;
    }
    $normalized = json_encode(refreshCachedPayload($payload), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return is_string($normalized) && strlen($normalized) <= MAX_CACHE_BYTES ? $normalized : null;
}

function writeCachedJson(string $path, string $json): bool
{
    if (is_link($path)) {
        return false;
    }
    $temporary = @tempnam(dirname($path), 'ellan-performance-');
    if (!is_string($temporary)) {
        return false;
    }
    $written = @file_put_contents($temporary, $json, LOCK_EX);
    if ($written === strlen($json)) {
        @chmod($temporary, 0600);
        if (@rename($temporary, $path)) {
            return true;
        }
    }
    @unlink($temporary);
    return false;
}

function recentFailure(string $path): bool
{
    if (is_link($path)) {
        return false;
    }
    clearstatcache(true, $path);
    $modified = @filemtime($path);
    return is_int($modified) && time() - $modified <= FAILURE_RETRY_SECONDS;
}

function markFailure(string $path): void
{
    if (!is_link($path) && @touch($path)) {
        @chmod($path, 0600);
    }
}

function upstreamRequests(): array
{
    $requests = [];
    foreach (PLAN_NODES as $id => $node) {
        $server = rawurlencode($node['uuid']);
        $requests[$id . ':performance'] = [
            'url' => PLAN_BASE_URL . '/v1/graph?server=' . $server . '&type=optimizedPerformance',
            'maximum_bytes' => MAX_PERFORMANCE_BYTES,
        ];
        $requests[$id . ':ping'] = [
            'url' => PLAN_BASE_URL . '/v1/graph?server=' . $server . '&type=aggregatedPing',
            'maximum_bytes' => MAX_GRAPH_BYTES,
        ];
    }
    $requests['players'] = [
        'url' => PLAN_BASE_URL . '/v1/graph?type=playersOnlineProxies',
        'maximum_bytes' => MAX_GRAPH_BYTES,
    ];
    return $requests;
}

function fetchUpstreamBodies(array $requests): ?array
{
    if (!function_exists('curl_multi_init')) {
        return null;
    }
    $bodies = array_fill_keys(array_keys($requests), '');
    $tooLarge = array_fill_keys(array_keys($requests), false);
    $totalBytes = 0;
    $totalTooLarge = false;
    $handles = [];
    $multi = curl_multi_init();
    foreach ($requests as $key => $request) {
        $handle = curl_init($request['url']);
        if ($handle === false) {
            return null;
        }
        $maximumBytes = $request['maximum_bytes'];
        curl_setopt_array($handle, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 24,
            CURLOPT_LOW_SPEED_LIMIT => 128,
            CURLOPT_LOW_SPEED_TIME => 12,
            CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'Ellan-Website-PLAN-Performance/2.0',
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$bodies, &$tooLarge, &$totalBytes, &$totalTooLarge, $key, $maximumBytes): int {
                $length = strlen($chunk);
                if (strlen($bodies[$key]) + $length > $maximumBytes || $totalBytes + $length > MAX_UPSTREAM_TOTAL_BYTES) {
                    $tooLarge[$key] = true;
                    $totalTooLarge = true;
                    return 0;
                }
                $bodies[$key] .= $chunk;
                $totalBytes += $length;
                return $length;
            },
        ]);
        $handles[$key] = $handle;
        curl_multi_add_handle($multi, $handle);
    }

    $running = 0;
    do {
        $status = curl_multi_exec($multi, $running);
        if ($status !== CURLM_OK) {
            break;
        }
        if ($running > 0) {
            $selected = curl_multi_select($multi, 1.0);
            if ($selected === -1) {
                usleep(100000);
            }
        }
    } while ($running > 0);

    $valid = isset($status) && $status === CURLM_OK && !$totalTooLarge;
    foreach ($handles as $key => $handle) {
        $httpStatus = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $contentType = (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
        if (curl_errno($handle) !== 0
            || $tooLarge[$key]
            || $httpStatus !== 200
            || stripos($contentType, 'application/json') === false
            || $bodies[$key] === '') {
            $valid = false;
        }
        curl_multi_remove_handle($multi, $handle);
        curl_close($handle);
    }
    curl_multi_close($multi);
    return $valid ? $bodies : null;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    header('Allow: GET');
    respondWithError(405, '仅支持 GET 请求');
}
if (($_SERVER['QUERY_STRING'] ?? '') !== '') {
    respondWithError(400, '不支持查询参数');
}

$requests = upstreamRequests();
$cacheDirectory = privateCacheDirectory();
if ($cacheDirectory === null) {
    respondWithError(503, '性能数据缓存不可用');
}
$cacheKey = hash('sha256', implode('|', array_column($requests, 'url')) . '|v2');
$cachePath = $cacheDirectory . DIRECTORY_SEPARATOR . 'payload-' . substr($cacheKey, 0, 16) . '.json';
$failurePath = $cachePath . '.failed';
$freshJson = cachedJson($cachePath, CACHE_TTL_SECONDS);
if ($freshJson !== null) {
    respondWithJson($freshJson);
}
$staleJson = cachedJson($cachePath, STALE_TTL_SECONDS);
if (recentFailure($failurePath)) {
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    header('Retry-After: ' . FAILURE_RETRY_SECONDS);
    respondWithError(503, 'PLAN 性能数据正在恢复');
}

$lockPath = $cachePath . '.lock';
if (is_link($lockPath)) {
    respondWithError(503, '性能数据缓存不可用');
}
$lockHandle = @fopen($lockPath, 'c');
if ($lockHandle === false) {
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    respondWithError(503, '性能数据缓存不可用');
}
@chmod($lockPath, 0600);
if (!@flock($lockHandle, LOCK_EX | LOCK_NB)) {
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    for ($attempt = 0; $attempt < 20; $attempt++) {
        usleep(100000);
        $freshJson = cachedJson($cachePath, CACHE_TTL_SECONDS);
        if ($freshJson !== null) {
            respondWithJson($freshJson);
        }
    }
    header('Retry-After: 5');
    respondWithError(503, '性能数据正在同步');
}

$freshJson = cachedJson($cachePath, CACHE_TTL_SECONDS);
if ($freshJson !== null) {
    respondWithJson($freshJson);
}
$bodies = fetchUpstreamBodies($requests);
$payload = is_array($bodies) ? buildPayload($bodies) : null;
if ($payload === null || !validPayload($payload)) {
    markFailure($failurePath);
    $fallbackJson = cachedJson($cachePath, STALE_TTL_SECONDS);
    if ($fallbackJson !== null) {
        respondWithJson($fallbackJson, true);
    }
    respondWithError(502, 'PLAN 性能数据暂时不可用');
}
$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if (!is_string($json) || strlen($json) > MAX_CACHE_BYTES) {
    respondWithError(500, '性能数据编码失败');
}
if (writeCachedJson($cachePath, $json)) {
    @unlink($failurePath);
} else {
    markFailure($failurePath);
    error_log('PLAN performance cache write failed');
}
respondWithJson($json);
