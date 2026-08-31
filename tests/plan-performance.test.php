<?php
declare(strict_types=1);

// Load the bridge's pure functions without running its HTTP request handler.
$source = file_get_contents(__DIR__ . '/../website/api/plan-performance.php');
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

$now = (int) (microtime(true) * 1000);
$ranges = rangeMetadata($now);
$keys = ['date', 'playersOnline', 'tps', 'cpu', 'ram', 'entities', 'chunks', 'disk', 'msptAverage', 'mspt95thPercentile'];
$rows = [
    [$now - 180000, 12, 20, 15.5, 4096, 200, 500, 400000, 12, 20],
    [$now - 60000, 14, 19.9, 18, 4200, 250, 600, 399000, 14, 22],
];
$parse = static fn(array $payload) => performanceData(json_encode($payload, JSON_THROW_ON_ERROR), $ranges, $now);
$original = $parse(['keys' => $keys, 'values' => $rows]);
check($original !== null && $original['current']['players'] === 14.0, 'Legacy metrics must parse');

$extendedKeys = array_merge($keys, ['msptJitterAverage', 'msptJitterMax']);
$extendedRows = array_map(static fn($row) => array_merge($row, [3, 7]), $rows);
$extended = $parse(['keys' => $extendedKeys, 'values' => $extendedRows]);
check($extended === $original, 'New Plan columns must not affect existing metrics');
check(array_keys($extended['current']) === array_keys(PERFORMANCE_METRICS), 'Extra fields must not leak into output');
check($parse(['keys' => array_reverse($extendedKeys), 'values' => array_map('array_reverse', $extendedRows)]) === $original, 'Column order must not matter');

$missingKeys = $extendedKeys;
$missingKeys[2] = 'unrecognizedMetric';
check($parse(['keys' => $missingKeys, 'values' => $extendedRows]) === null, 'Missing TPS must be rejected');
$duplicateKeys = $extendedKeys;
$duplicateKeys[10] = 'tps';
check($parse(['keys' => $duplicateKeys, 'values' => $extendedRows]) === null, 'Duplicate columns must be rejected');
check($parse(['keys' => $extendedKeys, 'values' => $rows]) === null, 'Mismatched row width must be rejected');
$tooManyKeys = array_merge($extendedKeys, array_map(static fn($n) => 'extra' . $n, range(1, MAX_KEYS)));
check($parse(['keys' => $tooManyKeys, 'values' => $extendedRows]) === null, 'Column limit must remain bounded');
echo "PASS: legacy/new/reordered metrics, output whitelist, missing/duplicate/malformed/oversized columns\n";
