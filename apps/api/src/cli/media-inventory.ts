import db from '../database/data-source';
import { MediaStorage } from '../modules/media/media-storage';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

async function run(): Promise<void> {
  await db.initialize();
  const storage = new MediaStorage();
  try {
    const rows = await db.query<{ storage_key: string; deleted_at: Date | null }[]>(
      'SELECT storage_key,deleted_at FROM media_assets',
    );
    const tracked = new Map(rows.map((row) => [row.storage_key, row]));
    const seen = new Set<string>(),
      objectOnly: {
        key: string;
        lastModified: Date | null;
        byteSize: number;
        olderThan24Hours: boolean;
      }[] = [];
    let truncated = false,
      inspected = 0;
    for await (const object of storage.inventory()) {
      if (inspected++ >= 10000) {
        truncated = true;
        break;
      }
      if (!/^[a-f0-9-]{36}\.webp$/.test(object.key)) continue;
      seen.add(object.key);
      if (!tracked.has(object.key))
        objectOnly.push({
          ...object,
          olderThan24Hours:
            object.lastModified !== null && Date.now() - object.lastModified.getTime() > 86400000,
        });
    }
    const missing = truncated
      ? null
      : rows
          .filter((row) => row.deleted_at === null && !seen.has(row.storage_key))
          .map((row) => row.storage_key);
    const report = {
      measuredAt: new Date().toISOString(),
      mode: 'read-only',
      truncated,
      counts: {
        objectsScanned: seen.size,
        trackedAssets: rows.length,
        objectOnly: objectOnly.length,
        oldObjectOnlyCandidates: objectOnly.filter((o) => o.olderThan24Hours).length,
        missingObjects: missing?.length ?? null,
      },
      objectOnly,
      missing,
    };
    const target =
      process.env.MEDIA_INVENTORY_REPORT ??
      resolve(__dirname, '../../../../.cache/media-inventory.json');
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
    console.log(JSON.stringify({ mode: 'read-only', truncated, ...report.counts }));
  } finally {
    storage.onModuleDestroy();
    await db.destroy();
  }
}
void run().catch(() => {
  console.error(
    'Media inventory failed; verify storage list permission, migrations and report-directory access',
  );
  process.exitCode = 1;
});
