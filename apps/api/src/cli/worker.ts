import db from '../database/data-source';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { OutboxService } from '../modules/jobs/outbox.service';

async function run(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url || !['redis:', 'rediss:'].includes(new URL(url).protocol))
    throw Error('Set REDIS_URL for the worker');
  const producer = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 3000,
  });
  const consumer = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    connectTimeout: 3000,
  });
  producer.on('error', () => console.error('Event queue connection unavailable'));
  consumer.on('error', () => console.error('Event worker connection unavailable'));
  let queue: Queue | undefined,
    worker: Worker | undefined,
    stopping = false;
  const instanceId = randomUUID();
  const stop = () => {
    stopping = true;
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await db.initialize();
    if (await db.showMigrations()) throw Error('Pending migrations');
    await db.query('INSERT INTO worker_heartbeats(id) VALUES($1)', [instanceId]);
    await producer.connect();
    await consumer.connect();
    queue = new Queue('atlas-events', { connection: producer });
    const outbox = new OutboxService(db);
    worker = new Worker(
      'atlas-events',
      async (job) => {
        await outbox.process(String(job.data.eventId));
      },
      { connection: consumer, concurrency: 4 },
    );
    worker.on('error', () => console.error('Event worker error'));
    worker.on('failed', (job) => {
      if (job && job.attemptsMade >= 5)
        void db
          .query(
            "UPDATE outbox_events SET state='failed',error_code='HANDLER_FAILED',lease_id=NULL,lease_until=NULL WHERE id=$1 AND state<>'completed'",
            [job.data.eventId],
          )
          .catch(() => console.error('Could not persist worker failure'));
    });
    console.log('Event worker started');
    while (!stopping) {
      await db.query('UPDATE worker_heartbeats SET last_seen_at=now() WHERE id=$1', [instanceId]);
      await outbox.dispatch({
        enqueue: async (eventId) => {
          const prior = await queue!.getJob(eventId);
          if (prior && (await prior.getState()) === 'failed') await prior.remove();
          await queue!.add(
            'domain-event',
            { eventId },
            {
              jobId: eventId,
              attempts: 5,
              backoff: { type: 'exponential', delay: 1000 },
              removeOnComplete: true,
              removeOnFail: { count: 1000 },
            },
          );
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    if (worker) await worker.close();
    if (queue) await queue.close();
    producer.disconnect();
    consumer.disconnect();
    if (db.isInitialized) {
      await db
        .query('UPDATE worker_heartbeats SET stopped_at=now() WHERE id=$1', [instanceId])
        .catch(() => undefined);
      await db.destroy();
    }
  }
}
void run().catch(() => {
  console.error('Worker stopped: verify DB migrations and Redis configuration');
  process.exitCode = 1;
});
