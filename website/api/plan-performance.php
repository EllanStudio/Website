<?php
declare(strict_types=1);

const PLAN_PERFORMANCE_URL = 'http://43.249.195.103:16884/v1/graph?server=9354d4b2-d4a4-4358-9fa1-3771fe3170c7&type=optimizedPerformance';
const PLAN_PLAYERS_URL = 'http://43.249.195.103:16884/v1/graph?type=playersOnlineProxies';
const MAX_PERFORMANCE_BYTES = 6291456;
const MAX_PLAYERS_BYTES = 4194304;
const MAX_CACHE_BYTES = 262144;
const MAX_PERFORMANCE_KEYS = 64;
const MAX_PERFORMANCE_ROWS = 60000;
const MAX_PLAYER_GRAPHS = 16;
const MAX_PLAYER_POINTS = 60000;
const MAX_PLAYER_POINTS_TOTAL = 120000;
const MIN_TIMESTAMP_MS = 1577836800000;
const HISTORY_WINDOW_MS = 86400000;
const BUCKET_MS = 600000;
const CACHE_TTL_SECONDS = 300;
const STALE_TTL_SECONDS = 1800;
const FAILURE_RETRY_SECONDS = 60;

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

function validSeries($series, float $minimum, float $maximum): bool
{
    $expectedPoints = intdiv(HISTORY_WINDOW_MS, BUCKET_MS) + 1;
    if (!is_array($series) || count($series) !== $expectedPoints) {
        return false;
    }
    $previous = null;
    $numericPoints = 0;
    $maximumTimestamp = (time() + 300) * 1000;
    foreach ($series as $point) {
        if (!is_array($point) || count($point) !== 2) {
            return false;
        }
        $timestamp = boundedNumber($point[0] ?? null, MIN_TIMESTAMP_MS, $maximumTimestamp);
        if ($timestamp === null) {
            return false;
        }
        $timestamp = (int) $timestamp;
        if ($timestamp % BUCKET_MS !== 0 || ($previous !== null && $timestamp !== $previous + BUCKET_MS)) {
            return false;
        }
        if (($point[1] ?? null) !== null) {
            if (boundedNumber($point[1], $minimum, $maximum) === null) {
                return false;
            }
            $numericPoints++;
        }
        $previous = $timestamp;
    }
    return $numericPoints >= 2;
}

function validPayload($payload): bool
{
    if (!is_array($payload) || !isset($payload['timestamp'], $payload['current'], $payload['series'])) {
        return false;
    }
    $maximumTimestamp = (time() + 300) * 1000;
    if (boundedNumber($payload['timestamp'], MIN_TIMESTAMP_MS, $maximumTimestamp) === null
        || ($payload['window_ms'] ?? null) !== HISTORY_WINDOW_MS
        || ($payload['bucket_ms'] ?? null) !== BUCKET_MS
        || ($payload['refresh_seconds'] ?? null) !== CACHE_TTL_SECONDS
        || !is_array($payload['current'])
        || !is_array($payload['series'])) {
        return false;
    }
    $valid = boundedNumber($payload['current']['tps'] ?? null, 0, 21) !== null
        && boundedNumber($payload['current']['memory_mb'] ?? null, 0, 1000000) !== null
        && boundedNumber($payload['current']['players'] ?? null, 0, 1000000) !== null
        && validSeries($payload['series']['tps'] ?? null, 0, 21)
        && validSeries($payload['series']['memory'] ?? null, 0, 1000000)
        && validSeries($payload['series']['players'] ?? null, 0, 1000000);
    if (!$valid) {
        return false;
    }
    for ($index = 0; $index < count($payload['series']['tps']); $index++) {
        $timestamp = $payload['series']['tps'][$index][0];
        if ($payload['series']['memory'][$index][0] !== $timestamp
            || $payload['series']['players'][$index][0] !== $timestamp) {
            return false;
        }
    }
    return true;
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
    return validPayload($payload) ? $json : null;
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
    if (is_link($path)) {
        return;
    }
    if (@touch($path)) {
        @chmod($path, 0600);
    }
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

function fetchUpstreamBodies(): ?array
{
    if (!function_exists('curl_multi_init')) {
        return null;
    }

    $urls = [
        'performance' => PLAN_PERFORMANCE_URL,
        'players' => PLAN_PLAYERS_URL,
    ];
    $bodies = ['performance' => '', 'players' => ''];
    $tooLarge = ['performance' => false, 'players' => false];
    $handles = [];
    $multi = curl_multi_init();

    foreach ($urls as $key => $url) {
        $maximumBytes = $key === 'performance' ? MAX_PERFORMANCE_BYTES : MAX_PLAYERS_BYTES;
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_LOW_SPEED_LIMIT => 128,
            CURLOPT_LOW_SPEED_TIME => 7,
            CURLOPT_ENCODING => '',
            CURLOPT_HTTPHEADER => ['Accept: application/json'],
            CURLOPT_USERAGENT => 'Ellan-Website-PLAN-Performance/1.0',
            CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$bodies, &$tooLarge, $key, $maximumBytes): int {
                $length = strlen($chunk);
                if (strlen($bodies[$key]) + $length > $maximumBytes) {
                    $tooLarge[$key] = true;
                    return 0;
                }
                $bodies[$key] .= $chunk;
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

    $valid = isset($status) && $status === CURLM_OK;
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

function performanceSeries(array $payload, int $now): ?array
{
    if (!isset($payload['keys'], $payload['values']) || !is_array($payload['keys']) || !is_array($payload['values'])) {
        return null;
    }
    if (count($payload['keys']) < 3 || count($payload['keys']) > MAX_PERFORMANCE_KEYS
        || count($payload['values']) < 2 || count($payload['values']) > MAX_PERFORMANCE_ROWS) {
        return null;
    }
    foreach ($payload['keys'] as $key) {
        if (!is_string($key) || $key === '') {
            return null;
        }
    }
    $indexes = array_flip($payload['keys']);
    if (count($indexes) !== count($payload['keys']) || !isset($indexes['date'], $indexes['tps'], $indexes['ram'])) {
        return null;
    }

    $windowEnd = intdiv($now, BUCKET_MS) * BUCKET_MS;
    $windowStart = $windowEnd - HISTORY_WINDOW_MS;
    $maximumTimestamp = $now + 300000;
    $buckets = [];
    $latestTimestamp = 0;
    $latestTps = null;
    $latestMemory = null;

    foreach ($payload['values'] as $row) {
        if (!is_array($row) || count($row) !== count($payload['keys'])) {
            return null;
        }
        $timestamp = boundedNumber($row[$indexes['date']] ?? null, $windowStart, $maximumTimestamp);
        $tps = boundedNumber($row[$indexes['tps']] ?? null, 0, 21);
        $memory = boundedNumber($row[$indexes['ram']] ?? null, 0, 1000000);
        if ($timestamp === null || $tps === null || $memory === null) {
            continue;
        }
        $timestamp = (int) $timestamp;
        $bucket = intdiv($timestamp, BUCKET_MS) * BUCKET_MS;
        if ($bucket < $windowStart || $bucket > $windowEnd) {
            continue;
        }
        if (!isset($buckets[$bucket])) {
            $buckets[$bucket] = ['tps' => 0.0, 'memory' => 0.0, 'count' => 0];
        }
        $buckets[$bucket]['tps'] += $tps;
        $buckets[$bucket]['memory'] += $memory;
        $buckets[$bucket]['count']++;
        if ($timestamp > $latestTimestamp) {
            $latestTimestamp = $timestamp;
            $latestTps = $tps;
            $latestMemory = $memory;
        }
    }

    $tpsSeries = [];
    $memorySeries = [];
    for ($timestamp = $windowStart; $timestamp <= $windowEnd; $timestamp += BUCKET_MS) {
        if (!isset($buckets[$timestamp])) {
            $tpsSeries[] = [$timestamp, null];
            $memorySeries[] = [$timestamp, null];
            continue;
        }
        $bucket = $buckets[$timestamp];
        $tpsSeries[] = [(int) $timestamp, round($bucket['tps'] / $bucket['count'], 2)];
        $memorySeries[] = [(int) $timestamp, round($bucket['memory'] / $bucket['count'])];
    }

    if ($latestTps === null || $latestMemory === null || $latestTimestamp < $windowEnd - (2 * BUCKET_MS)) {
        return null;
    }
    return [
        'timestamp' => $latestTimestamp,
        'current_tps' => round($latestTps, 2),
        'current_memory' => round($latestMemory),
        'tps' => $tpsSeries,
        'memory' => $memorySeries,
    ];
}

function playerSeries(array $payload, int $now): ?array
{
    if (!isset($payload['graphs']) || !is_array($payload['graphs'])) {
        return null;
    }
    if (count($payload['graphs']) < 1 || count($payload['graphs']) > MAX_PLAYER_GRAPHS) {
        return null;
    }
    $windowEnd = intdiv($now, BUCKET_MS) * BUCKET_MS;
    $windowStart = $windowEnd - HISTORY_WINDOW_MS;
    $maximumTimestamp = $now + 300000;
    $graphs = [];
    $latestTimestamp = 0;
    $currentPlayers = null;
    $totalPoints = 0;

    foreach ($payload['graphs'] as $graph) {
        if (!isset($graph['points']) || !is_array($graph['points'])
            || count($graph['points']) < 2 || count($graph['points']) > MAX_PLAYER_POINTS) {
            return null;
        }
        $totalPoints += count($graph['points']);
        if ($totalPoints > MAX_PLAYER_POINTS_TOTAL) {
            return null;
        }
        $graphBuckets = [];
        foreach ($graph['points'] as $point) {
            if (!is_array($point) || count($point) !== 2) {
                return null;
            }
            $timestamp = boundedNumber($point[0] ?? null, $windowStart, $maximumTimestamp);
            $players = boundedNumber($point[1] ?? null, 0, 1000000);
            if ($timestamp === null || $players === null) {
                continue;
            }
            $timestamp = (int) $timestamp;
            $bucket = intdiv($timestamp, BUCKET_MS) * BUCKET_MS;
            if ($bucket < $windowStart || $bucket > $windowEnd) {
                continue;
            }
            if (!isset($graphBuckets[$bucket])) {
                $graphBuckets[$bucket] = ['total' => 0.0, 'count' => 0];
            }
            $graphBuckets[$bucket]['total'] += $players;
            $graphBuckets[$bucket]['count']++;
        }
        if (count($graphBuckets) < 2) {
            return null;
        }
        foreach ($graphBuckets as $timestamp => $bucket) {
            $graphBuckets[$timestamp] = $bucket['total'] / $bucket['count'];
        }
        $graphs[] = $graphBuckets;
    }

    $series = [];
    $numericPoints = 0;
    for ($timestamp = $windowStart; $timestamp <= $windowEnd; $timestamp += BUCKET_MS) {
        $players = 0.0;
        foreach ($graphs as $graphBuckets) {
            if (!isset($graphBuckets[$timestamp])) {
                $players = null;
                break;
            }
            $players += $graphBuckets[$timestamp];
        }
        if ($players === null) {
            $series[] = [$timestamp, null];
            continue;
        }
        $players = round($players, 2);
        $series[] = [$timestamp, $players];
        $latestTimestamp = $timestamp;
        $currentPlayers = $players;
        $numericPoints++;
    }
    return $numericPoints >= 2 && $currentPlayers !== null && $latestTimestamp >= $windowEnd - (2 * BUCKET_MS) ? [
        'timestamp' => $latestTimestamp,
        'current' => round($currentPlayers),
        'series' => $series,
    ] : null;
}

function buildPayload(array $bodies): ?array
{
    $now = time() * 1000;
    $performancePayload = json_decode($bodies['performance'], true, 16);
    if (!is_array($performancePayload)) {
        return null;
    }
    $performance = performanceSeries($performancePayload, $now);
    unset($performancePayload);
    if ($performance === null) {
        return null;
    }

    $playersPayload = json_decode($bodies['players'], true, 16);
    if (!is_array($playersPayload)) {
        return null;
    }
    $players = playerSeries($playersPayload, $now);
    unset($playersPayload);
    if ($players === null) {
        return null;
    }

    return [
        'timestamp' => max($performance['timestamp'], $players['timestamp']),
        'window_ms' => HISTORY_WINDOW_MS,
        'bucket_ms' => BUCKET_MS,
        'refresh_seconds' => CACHE_TTL_SECONDS,
        'current' => [
            'tps' => $performance['current_tps'],
            'memory_mb' => $performance['current_memory'],
            'players' => $players['current'],
        ],
        'series' => [
            'tps' => $performance['tps'],
            'memory' => $performance['memory'],
            'players' => $players['series'],
        ],
    ];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    header('Allow: GET');
    respondWithError(405, '仅支持 GET 请求');
}
if (($_SERVER['QUERY_STRING'] ?? '') !== '') {
    respondWithError(400, '不支持查询参数');
}

$cacheKey = hash('sha256', PLAN_PERFORMANCE_URL . '|' . PLAN_PLAYERS_URL);
$cacheDirectory = privateCacheDirectory();
if ($cacheDirectory === null) {
    respondWithError(503, '性能数据缓存不可用');
}
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

$bodies = fetchUpstreamBodies();
$payload = is_array($bodies) ? buildPayload($bodies) : null;
if ($payload === null || !validPayload($payload)) {
    markFailure($failurePath);
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    respondWithError(502, 'PLAN 性能数据暂时不可用');
}

$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if (!is_string($json) || strlen($json) > MAX_CACHE_BYTES) {
    respondWithError(500, '性能数据编码失败');
}
$cached = writeCachedJson($cachePath, $json);
if ($cached) {
    @unlink($failurePath);
} else {
    markFailure($failurePath);
    error_log('PLAN performance cache write failed');
}
respondWithJson($json);
