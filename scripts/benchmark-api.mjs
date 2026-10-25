import { mkdir, writeFile } from 'node:fs/promises';
const origin = new URL(process.env.BENCH_API_ORIGIN ?? 'http://localhost:3000');
if (origin.username || origin.password || !['http:', 'https:'].includes(origin.protocol))
  throw Error('Use an HTTP origin without credentials');
const requests = Number(process.env.BENCH_REQUESTS ?? 100),
  concurrency = Number(process.env.BENCH_CONCURRENCY ?? 5);
if (
  !Number.isInteger(requests) ||
  requests < 10 ||
  requests > 10000 ||
  !Number.isInteger(concurrency) ||
  concurrency < 1 ||
  concurrency > 50
)
  throw Error('Requests 10–10000; concurrency 1–50');
const paths = [
  '/health/ready',
  '/api/v1/games/stella-sora/characters?limit=20',
  '/api/v1/games/stella-sora/search?q=noya',
];
const percentile = (values, p) =>
  values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const results = [];
for (const path of paths) {
  const times = [],
    statuses = {};
  let next = 0;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next++ < requests) {
        const t = performance.now();
        let status = 'network_error';
        try {
          const r = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(10000) });
          await r.arrayBuffer();
          status = String(r.status);
        } catch {
          /* Count without printing connection details. */
        }
        times.push(performance.now() - t);
        statuses[status] = (statuses[status] ?? 0) + 1;
      }
    }),
  );
  times.sort((a, b) => a - b);
  const round = (x) => Math.round(x * 100) / 100;
  results.push({
    path,
    requests: times.length,
    concurrency,
    elapsedMs: round(performance.now() - started),
    p50Ms: round(percentile(times, 0.5)),
    p95Ms: round(percentile(times, 0.95)),
    p99Ms: round(percentile(times, 0.99)),
    statuses,
  });
}
const report = {
  measuredAt: new Date().toISOString(),
  note: 'Local read-only measurements; dataset size, API configuration and DB network affect results. Not a production capacity claim.',
  results,
};
await mkdir('.cache', { recursive: true });
await writeFile('.cache/backend-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (results.some((r) => Object.keys(r.statuses).some((s) => s !== '200'))) process.exitCode = 1;
