<?php
declare(strict_types=1);

// Load the pure helpers without running the HTTP handler.
$source = file_get_contents(__DIR__ . '/../website/api/launcher-news.php');
$handler = strpos($source, "\n\$method = \$_SERVER['REQUEST_METHOD'] ?? 'GET';");
if ($handler === false) {
    throw new RuntimeException('Cannot locate request handler');
}
eval(substr($source, strlen('<?php'), $handler - strlen('<?php')));

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$good = [
    'id' => 'B_abc-1', 'title' => "  艾尔岚 公告  ", 'summary' => 'x', 'date' => '2026-10-27T08:46:05+08:00',
    'category' => '更新日志', 'link' => 'https://pd.qq.com/g/7t440j2oby?subc=1',
    'image' => ['url' => 'https://channel.qpic.cn/a.png', 'width' => 827, 'height' => 1170],
];
$item = normalizeNewsItem($good);
check($item !== null && $item['title'] === '艾尔岚 公告', 'valid item must normalize and trim');
check($item['date'] === '2026-10-27T00:46:05+00:00', 'date must be normalized to UTC');
check($item['image']['width'] === 827, 'image must be kept');

check(normalizeNewsItem(array_merge($good, ['id' => 'bad id!'])) === null, 'bad id rejected');
check(normalizeNewsItem(array_merge($good, ['title' => ''])) === null, 'empty title rejected');
check(normalizeNewsItem(array_merge($good, ['date' => 'not a date'])) === null, 'bad date rejected');
check(normalizeNewsItem(array_merge($good, ['date' => '2999-01-01T00:00:00Z'])) === null, 'future date rejected');
check(normalizeNewsItem(array_merge($good, ['link' => 'javascript:alert(1)']))['link'] === '', 'javascript url dropped');
check(normalizeNewsItem(array_merge($good, ['link' => 'http://example.com/']))['link'] === '', 'http url dropped');
check(normalizeNewsItem(array_merge($good, ['link' => 'https://u:p@example.com/']))['link'] === '', 'credentials url dropped');
check(!isset(normalizeNewsItem(array_merge($good, ['image' => ['url' => 'http://x/a.png']]))['image']), 'http image dropped');
check(preg_match_all('/./su', normalizeNewsItem(array_merge($good, ['title' => str_repeat('艾', 500)]))['title']) === 120, 'title truncated');

$payload = normalizeNewsPayload(['items' => [
    $good,
    array_merge($good, ['title' => 'dup']),
    array_merge($good, ['id' => 'newer', 'date' => '2026-10-28T08:46:05+08:00']),
    ['garbage'],
]]);
check($payload !== null && count($payload['items']) === 2, 'duplicates and garbage dropped');
check($payload['items'][0]['id'] === 'newer', 'items sorted newest first');
check(normalizeNewsPayload(['nope' => 1]) === null, 'payload without items rejected');
$many = [];
for ($i = 0; $i < 100; $i++) {
    $many[] = array_merge($good, ['id' => 'n' . $i]);
}
check(count(normalizeNewsPayload(['items' => $many])['items']) === NEWS_MAX_ITEMS, 'item count capped');

check(!newsKeyIsValid(''), 'empty key rejected');
check(!newsKeyIsValid('wrong'), 'wrong key rejected');

echo "launcher-news tests passed\n";
