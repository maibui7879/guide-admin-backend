export class HttpTelemetry {
  private count = 0;
  private duration = 0;
  private searches = 0;
  private zeroResultSearches = 0;
  private readonly statuses: Record<string, number> = {
    '2xx': 0,
    '3xx': 0,
    '4xx': 0,
    '5xx': 0,
    other: 0,
  };
  private readonly boundaries = [10, 50, 100, 250, 500, 1000, 5000, Infinity];
  private readonly buckets = this.boundaries.map(() => 0);
  record(status: number, durationMs: number): void {
    this.count++;
    this.duration += durationMs;
    const key = `${Math.floor(status / 100)}xx`;
    this.statuses[key in this.statuses ? key : 'other']++;
    for (let i = 0; i < this.boundaries.length; i++)
      if (durationMs <= this.boundaries[i]) this.buckets[i]++;
  }
  snapshot() {
    return {
      requestCount: this.count,
      totalDurationMs: Math.round(this.duration),
      search: { requests: this.searches, zeroResultRequests: this.zeroResultSearches },
      statuses: { ...this.statuses },
      durationBuckets: this.boundaries.map((upperMs, i) => ({
        upperMs: Number.isFinite(upperMs) ? upperMs : null,
        count: this.buckets[i],
      })),
    };
  }
  recordSearch(total: number): void {
    this.searches++;
    if (total === 0) this.zeroResultSearches++;
  }
}

// Per-process protection; a trusted ingress must enforce fleet-wide limits in production.
export class PublicReadLimiter {
  private readonly buckets = new Map<string, { started: number; count: number }>();
  constructor(
    private readonly maximum: number,
    private readonly capacity = 10000,
  ) {}
  check(key: string, now = Date.now()): number | null {
    let bucket = this.buckets.get(key);
    if (!bucket || now - bucket.started >= 60000) {
      if (this.buckets.size >= this.capacity)
        for (const [id, b] of this.buckets) if (now - b.started >= 60000) this.buckets.delete(id);
      if (!bucket && this.buckets.size >= this.capacity) return 60;
      bucket = { started: now, count: 0 };
      this.buckets.set(key, bucket);
    }
    if (bucket.count >= this.maximum)
      return Math.max(1, Math.ceil((60000 - now + bucket.started) / 1000));
    bucket.count++;
    return null;
  }
}
