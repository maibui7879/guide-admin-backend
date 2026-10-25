import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtemp, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaStorage } from '../../src/modules/media/media-storage';
import { verifyStorage } from '../../src/cli/verify-storage';
async function inventory(storage: MediaStorage) {
  const result = [];
  for await (const object of storage.inventory()) result.push(object);
  return result;
}
jest.setTimeout(30000);
describe('Private media storage adapters', () => {
  const names = [
    'MEDIA_STORAGE_DRIVER',
    'MEDIA_LOCAL_DIR',
    'STORAGE_ENDPOINT',
    'STORAGE_REGION',
    'STORAGE_BUCKET',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ] as const;
  let previous: Record<string, string | undefined>;
  beforeEach(() => {
    previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  });
  afterEach(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  });
  it('writes private local objects and makes repeated removal safe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-storage-test-'));
    process.env.MEDIA_LOCAL_DIR = directory;
    process.env.MEDIA_STORAGE_DRIVER = 'local';
    const storage = new MediaStorage(),
      key = '11111111-1111-4111-8111-111111111111.webp';
    try {
      await storage.put(key, Buffer.from('fixture'));
      expect((await storage.get(key)).toString()).toBe('fixture');
      expect(await inventory(storage)).toMatchObject([{ key, byteSize: 7 }]);
      await storage.remove(key);
      await storage.remove(key);
      await expect(storage.get('../outside')).rejects.toThrow('Invalid storage key');
    } finally {
      await storage.remove(key);
      await rmdir(directory);
    }
  });
  it('uses signed path-style S3 PUT/GET/DELETE and surfaces storage failures', async () => {
    const objects = new Map<string, Buffer>();
    let publicAccess = false;
    let authorized = false,
      fail = false;
    const server = createServer(async (req, res) => {
      authorized ||= req.headers.authorization?.startsWith('AWS4-HMAC-SHA256 ') ?? false;
      const path = new URL(req.url!, 'http://fixture').pathname;
      if (!req.headers.authorization && !publicAccess) {
        res.writeHead(403);
        res.end();
        return;
      }
      if (fail) {
        res.writeHead(503, { 'content-type': 'application/xml' });
        res.end('<Error><Code>ServiceUnavailable</Code></Error>');
        return;
      }
      if (req.method === 'PUT') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        objects.set(path, Buffer.concat(chunks));
        res.writeHead(200);
        res.end();
      } else if (req.method === 'GET') {
        if (new URL(req.url!, 'http://fixture').searchParams.get('list-type') === '2') {
          res.writeHead(200, { 'content-type': 'application/xml' });
          res.end(
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><IsTruncated>false</IsTruncated>' +
              [...objects]
                .map(
                  ([key, value]) =>
                    `<Contents><Key>${key.slice('/private-bucket/'.length)}</Key><LastModified>2026-10-24T00:00:00.000Z</LastModified><Size>${value.length}</Size></Contents>`,
                )
                .join('') +
              '</ListBucketResult>',
          );
          return;
        }
        const data = objects.get(path);
        if (!data) {
          res.writeHead(404, { 'content-type': 'application/xml' });
          res.end('<Error><Code>NoSuchKey</Code></Error>');
          return;
        }
        res.writeHead(200, { 'content-type': 'image/webp', 'content-length': data.length });
        res.end(data);
      } else {
        objects.delete(path);
        res.writeHead(204);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    process.env.MEDIA_STORAGE_DRIVER = 's3';
    process.env.STORAGE_ENDPOINT = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.STORAGE_REGION = 'us-east-1';
    process.env.STORAGE_BUCKET = 'private-bucket';
    process.env.STORAGE_ACCESS_KEY = 'synthetic-key';
    process.env.STORAGE_SECRET_KEY = 'synthetic-secret';
    const storage = new MediaStorage(),
      key = '22222222-2222-4222-8222-222222222222.webp';
    try {
      await storage.put(key, Buffer.from('webp-fixture'));
      expect(objects.has('/private-bucket/' + key)).toBe(true);
      expect((await storage.get(key)).toString()).toBe('webp-fixture');
      expect(authorized).toBe(true);
      expect(await inventory(storage)).toMatchObject([{ key, byteSize: 12 }]);
      await storage.remove(key);
      await storage.remove(key);
      await expect(storage.get(key)).rejects.toThrow();
      const probeEnvironment = { ...process.env, STORAGE_VERIFY_ALLOW_WRITE: 'true' };
      await expect(verifyStorage(probeEnvironment)).resolves.toContain('deleted-object-not-found');
      expect(objects.size).toBe(0);
      publicAccess = true;
      await expect(verifyStorage(probeEnvironment)).rejects.toThrow('Anonymous storage access');
      expect(objects.size).toBe(0);
      fail = true;
      await expect(storage.put(key, Buffer.from('fixture'))).rejects.toThrow(
        'Image storage is unavailable',
      );
    } finally {
      storage.onModuleDestroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
