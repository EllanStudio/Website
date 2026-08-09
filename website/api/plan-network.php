<?php
declare(strict_types=1);

const PLAN_OVERVIEW_URL = 'http://43.249.195.103:16884/v1/network/overview';
const MAX_RESPONSE_BYTES = 131072;
const MIN_TIMESTAMP_MS = 1577836800000;
const MAX_COUNT = 1000000000;
const MAX_DURATION_MS = 9000000000000000;
const CACHE_TTL_SECONDS = 15;
const STALE_TTL_SECONDS = 300;

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

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
        ? 'Cache-Control: public, max-age=5, s-maxage=5, stale-if-error=300'
        : 'Cache-Control: public, max-age=15, s-maxage=15, stale-while-revalidate=45, stale-if-error=300');
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

function cachedJson(string $path, int $maximumAge): ?string
{
    clearstatcache(true, $path);
    $modified = @filemtime($path);
    $size = @filesize($path);
    if (!is_int($modified) || !is_int($size) || $size < 1 || $size > MAX_RESPONSE_BYTES || time() - $modified > $maximumAge) {
        return null;
    }
    $json = @file_get_contents($path, false, null, 0, MAX_RESPONSE_BYTES + 1);
    if (!is_string($json) || $json === '' || strlen($json) > MAX_RESPONSE_BYTES) {
        return null;
    }
    $payload = json_decode($json, true);
    $normalized = is_array($payload) ? normalizedPayload($payload) : null;
    if ($normalized === null) {
        return null;
    }
    $normalizedJson = json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return is_string($normalizedJson) ? $normalizedJson : null;
}

function writeCachedJson(string $path, string $json): void
{
    $temporary = @tempnam(dirname($path), 'ellan-plan-');
    if (!is_string($temporary)) {
        return;
    }
    $written = @file_put_contents($temporary, $json, LOCK_EX);
    if ($written === strlen($json)) {
        @chmod($temporary, 0600);
        if (@rename($temporary, $path)) {
            return;
        }
    }
    @unlink($temporary);
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

function boundedInteger($value, int $minimum, int $maximum)
{
    $number = boundedNumber($value, $minimum, $maximum);
    return $number !== null && floor((float) $number) === (float) $number ? $number : null;
}

function numericSubset(array $source, array $countFields, array $durationFields = [], array $timestampFields = []): array
{
    $result = [];
    foreach ($countFields as $field) {
        if (array_key_exists($field, $source) && ($number = boundedInteger($source[$field], 0, MAX_COUNT)) !== null) {
            $result[$field] = $number;
        }
    }
    foreach ($durationFields as $field) {
        if (array_key_exists($field, $source) && ($number = boundedNumber($source[$field], 0, MAX_DURATION_MS)) !== null) {
            $result[$field] = $number;
        }
    }
    $maximumTimestamp = (time() + 86400) * 1000;
    foreach ($timestampFields as $field) {
        if (array_key_exists($field, $source) && ($number = boundedNumber($source[$field], MIN_TIMESTAMP_MS, $maximumTimestamp)) !== null) {
            $result[$field] = $number;
        }
    }
    return $result;
}

function normalizedPayload(array $source): ?array
{
    if (!isset($source['numbers'], $source['players'], $source['weeks']) || !is_array($source['numbers']) || !is_array($source['players']) || !is_array($source['weeks'])) {
        return null;
    }
    $timestamp = boundedNumber($source['timestamp'] ?? null, MIN_TIMESTAMP_MS, (time() + 86400) * 1000);
    if ($timestamp === null) {
        return null;
    }

    $payload = [
        'timestamp' => $timestamp,
        'numbers' => numericSubset($source['numbers'], [
            'sessions',
            'regular_players',
            'best_peak_players',
            'last_peak_players',
            'total_players',
            'online_players',
        ], [
            'session_length_avg',
            'player_playtime',
            'current_uptime',
            'playtime',
        ], [
            'best_peak_date',
            'last_peak_date',
        ]),
        'players' => numericSubset($source['players'], [
            'new_players_1d',
            'unique_players_1d',
            'new_players_7d',
            'unique_players_7d',
            'new_players_30d',
            'unique_players_30d',
        ]),
        'weeks' => numericSubset($source['weeks'], [
            'unique_before',
            'unique_after',
            'new_before',
            'new_after',
            'regular_before',
            'regular_after',
            'sessions_before',
            'sessions_after',
        ], [
            'average_playtime_before',
            'average_playtime_after',
            'session_length_average_before',
            'session_length_average_after',
        ], [
            'start',
            'midpoint',
            'end',
        ]),
    ];

    if (count($payload['numbers']) !== 12 || count($payload['players']) !== 6 || count($payload['weeks']) !== 15 || $payload['numbers']['online_players'] > $payload['numbers']['total_players'] || $payload['numbers']['best_peak_players'] < $payload['numbers']['online_players'] || $payload['weeks']['start'] > $payload['weeks']['midpoint'] || $payload['weeks']['midpoint'] > $payload['weeks']['end'] || $payload['weeks']['end'] > $timestamp + 60000 || $payload['numbers']['best_peak_date'] > $timestamp || $payload['numbers']['last_peak_date'] > $timestamp) {
        return null;
    }
    return $payload;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method !== 'GET') {
    header('Allow: GET');
    respondWithError(405, '仅支持 GET 请求');
}
if (($_SERVER['QUERY_STRING'] ?? '') !== '') {
    respondWithError(400, '不支持查询参数');
}

$cachePath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'ellan-plan-network-' . substr(hash('sha256', PLAN_OVERVIEW_URL), 0, 16) . '.json';
$freshJson = cachedJson($cachePath, CACHE_TTL_SECONDS);
if ($freshJson !== null) {
    respondWithJson($freshJson);
}
$staleJson = cachedJson($cachePath, STALE_TTL_SECONDS);
$lockHandle = @fopen($cachePath . '.lock', 'c');
$cacheLocked = false;
if ($lockHandle === false) {
    error_log('Ellan PLAN bridge: unable to open refresh lock');
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    respondWithError(503, 'PLAN 数据缓存不可用');
} else {
    if (@flock($lockHandle, LOCK_EX | LOCK_NB)) {
        $cacheLocked = true;
        // Another request may have refreshed between the first read and taking this lock.
        $freshJson = cachedJson($cachePath, CACHE_TTL_SECONDS);
        $staleJson = cachedJson($cachePath, STALE_TTL_SECONDS);
        if ($freshJson !== null) {
            respondWithJson($freshJson);
        }
    } elseif ($staleJson !== null) {
        respondWithJson($staleJson, true);
    } else {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            usleep(100000);
            $freshJson = cachedJson($cachePath, CACHE_TTL_SECONDS);
            if ($freshJson !== null) {
                respondWithJson($freshJson);
            }
        }
        header('Retry-After: 2');
        respondWithError(503, 'PLAN 数据正在同步');
    }
}

if (!function_exists('curl_init')) {
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    respondWithError(500, '服务器缺少数据连接能力');
}

$body = '';
$responseTooLarge = false;
$curl = curl_init(PLAN_OVERVIEW_URL);
curl_setopt_array($curl, [
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_TIMEOUT => 7,
    CURLOPT_LOW_SPEED_LIMIT => 128,
    CURLOPT_LOW_SPEED_TIME => 5,
    CURLOPT_ENCODING => '',
    CURLOPT_HTTPHEADER => ['Accept: application/json'],
    CURLOPT_USERAGENT => 'Ellan-Website-PLAN-Bridge/1.0',
    CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body, &$responseTooLarge): int {
        $length = strlen($chunk);
        if (strlen($body) + $length > MAX_RESPONSE_BYTES) {
            $responseTooLarge = true;
            return 0;
        }
        $body .= $chunk;
        return $length;
    },
]);

$success = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
$contentType = (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE);
curl_close($curl);

if ($success !== true || $responseTooLarge || $status !== 200 || stripos($contentType, 'application/json') === false) {
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    respondWithError(502, 'PLAN 数据暂时不可用');
}

$source = json_decode($body, true);
$payload = is_array($source) ? normalizedPayload($source) : null;
if ($payload === null) {
    if ($staleJson !== null) {
        respondWithJson($staleJson, true);
    }
    respondWithError(502, 'PLAN 返回了无效数据');
}

$json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if (!is_string($json)) {
    respondWithError(500, '数据编码失败');
}

if ($cacheLocked) {
    writeCachedJson($cachePath, $json);
}
respondWithJson($json);
