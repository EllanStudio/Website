<?php
declare(strict_types=1);

// 艾尔岚服务器新闻：启动器与官网新闻页共用。
// GET  公开读取（带 CORS，启动器渲染进程需要）。
// POST 仅限持有共享密钥的同步任务写入（密钥只保存其 SHA-256）。
const NEWS_KEY_SHA256 = '732cacd9e7e24ffcb4b41bc5bb590e5b8b77510e8274d095e6b19f41ba3a89b4';
const NEWS_MAX_ITEMS = 40;
const NEWS_MAX_BODY_BYTES = 262144;
const NEWS_MAX_AGE_SECONDS = 2592000 * 12;

header('X-Content-Type-Options: nosniff');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, X-Ellan-News-Key');
header('Access-Control-Max-Age: 86400');

function newsRespond(int $status, array $body, string $cache = 'no-store'): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: ' . $cache);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function newsCleanText(mixed $value, int $maxChars): ?string
{
    if (!is_string($value)) {
        return null;
    }
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value);
    if (!is_string($value)) {
        return null;
    }
    $value = trim($value);
    if ($value === '') {
        return null;
    }
    // Not every PHP build ships mbstring; PCRE with /u counts code points.
    return preg_match('/^.{0,' . $maxChars . '}/su', $value, $head) === 1 ? $head[0] : $value;
}

function newsCleanUrl(mixed $value, int $maxChars = 1000): ?string
{
    if (!is_string($value) || strlen($value) > $maxChars || preg_match('/[\x00-\x20\x7F"<>\\\\]/', $value)) {
        return null;
    }
    $parts = parse_url($value);
    if (!is_array($parts) || ($parts['scheme'] ?? '') !== 'https' || empty($parts['host'])
        || isset($parts['user']) || isset($parts['pass'])) {
        return null;
    }
    return $value;
}

function normalizeNewsItem(mixed $raw): ?array
{
    if (!is_array($raw)) {
        return null;
    }
    $id = $raw['id'] ?? null;
    if (!is_string($id) || !preg_match('/^[A-Za-z0-9_.-]{1,80}$/', $id)) {
        return null;
    }
    $title = newsCleanText($raw['title'] ?? null, 120);
    $timestamp = is_string($raw['date'] ?? null) ? strtotime($raw['date']) : false;
    if ($title === null || $timestamp === false || $timestamp < 1577836800 || $timestamp > time() + 86400) {
        return null;
    }
    $item = [
        'id' => $id,
        'title' => $title,
        'summary' => newsCleanText($raw['summary'] ?? null, 400) ?? '',
        'date' => gmdate('c', $timestamp),
        'category' => newsCleanText($raw['category'] ?? null, 16) ?? '公告',
        'link' => newsCleanUrl($raw['link'] ?? null) ?? '',
    ];
    $image = $raw['image'] ?? null;
    if (is_array($image) && ($url = newsCleanUrl($image['url'] ?? null)) !== null) {
        $width = (int) ($image['width'] ?? 0);
        $height = (int) ($image['height'] ?? 0);
        $item['image'] = [
            'url' => $url,
            'width' => $width > 0 && $width <= 20000 ? $width : 0,
            'height' => $height > 0 && $height <= 20000 ? $height : 0,
        ];
    }
    return $item;
}

function normalizeNewsPayload(mixed $payload): ?array
{
    if (!is_array($payload) || !isset($payload['items']) || !is_array($payload['items'])) {
        return null;
    }
    $items = [];
    $seen = [];
    foreach ($payload['items'] as $raw) {
        $item = normalizeNewsItem($raw);
        if ($item === null || isset($seen[$item['id']])) {
            continue;
        }
        $seen[$item['id']] = true;
        $items[] = $item;
    }
    usort($items, static fn(array $a, array $b): int => strcmp($b['date'], $a['date']));
    return ['items' => array_slice($items, 0, NEWS_MAX_ITEMS), 'updated' => gmdate('c')];
}

function newsKeyIsValid(string $provided): bool
{
    return $provided !== '' && hash_equals(NEWS_KEY_SHA256, hash('sha256', $provided));
}

function newsStorageDirectory(): ?string
{
    $directory = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'ellan-launcher-news';
    clearstatcache(true, $directory);
    if (is_link($directory)) {
        return null;
    }
    if (!is_dir($directory) && !@mkdir($directory, 0700) && !is_dir($directory)) {
        return null;
    }
    return is_writable($directory) ? $directory : null;
}

function newsLoad(?string $directory, string $seedPath): array
{
    foreach ([$directory !== null ? $directory . DIRECTORY_SEPARATOR . 'news.json' : null, $seedPath] as $path) {
        if ($path === null || !is_file($path)) {
            continue;
        }
        $json = @file_get_contents($path, false, null, 0, NEWS_MAX_BODY_BYTES + 1);
        $data = is_string($json) ? json_decode($json, true) : null;
        if (is_array($data) && isset($data['items']) && is_array($data['items'])) {
            return ['items' => array_values($data['items']), 'updated' => $data['updated'] ?? null];
        }
    }
    return ['items' => [], 'updated' => null];
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($method === 'POST') {
    if (!newsKeyIsValid($_SERVER['HTTP_X_ELLAN_NEWS_KEY'] ?? '')) {
        newsRespond(403, ['error' => 'forbidden']);
    }
    $body = file_get_contents('php://input', false, null, 0, NEWS_MAX_BODY_BYTES + 1);
    if (!is_string($body) || $body === '' || strlen($body) > NEWS_MAX_BODY_BYTES) {
        newsRespond(413, ['error' => 'invalid body size']);
    }
    $normalized = normalizeNewsPayload(json_decode($body, true));
    if ($normalized === null) {
        newsRespond(400, ['error' => 'invalid payload']);
    }
    $directory = newsStorageDirectory();
    if ($directory === null) {
        newsRespond(503, ['error' => 'storage unavailable']);
    }
    $target = $directory . DIRECTORY_SEPARATOR . 'news.json';
    $temporary = $target . '.' . bin2hex(random_bytes(6)) . '.tmp';
    $json = json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (@file_put_contents($temporary, $json, LOCK_EX) === false || !@rename($temporary, $target)) {
        @unlink($temporary);
        newsRespond(503, ['error' => 'write failed']);
    }
    newsRespond(200, ['ok' => true, 'count' => count($normalized['items'])]);
}

if ($method !== 'GET' && $method !== 'HEAD') {
    header('Allow: GET, POST, OPTIONS');
    newsRespond(405, ['error' => 'method not allowed']);
}

$news = newsLoad(newsStorageDirectory(), __DIR__ . '/../data/launcher-news.seed.json');
newsRespond(200, $news, 'public, max-age=60, s-maxage=60, stale-while-revalidate=120, stale-if-error=600');
