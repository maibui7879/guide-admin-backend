import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';

/** Writes only a fresh probe object; never uses application metadata or existing keys. */
export async function verifyStorage(input: NodeJS.ProcessEnv): Promise<string[]> {
  const required = [
    'STORAGE_ENDPOINT',
    'STORAGE_BUCKET',
    'STORAGE_REGION',
    'STORAGE_ACCESS_KEY',
    'STORAGE_SECRET_KEY',
  ];
  if (required.some((name) => !input[name]) || input.STORAGE_VERIFY_ALLOW_WRITE !== 'true')
    throw new Error('Storage verification requires explicit configuration and write opt-in');
  const endpoint = new URL(input.STORAGE_ENDPOINT!);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' && input.NODE_ENV !== 'test')
  )
    throw new Error('Storage verification requires a credential-free HTTPS endpoint');
  const client = new S3Client({
    endpoint: endpoint.href,
    region: input.STORAGE_REGION,
    forcePathStyle: true,
    maxAttempts: 2,
    credentials: {
      accessKeyId: input.STORAGE_ACCESS_KEY!,
      secretAccessKey: input.STORAGE_SECRET_KEY!,
    },
    requestHandler: { connectionTimeout: 3000, requestTimeout: 10000 },
  });
  const Bucket = input.STORAGE_BUCKET!,
    Key = randomUUID() + '.webp',
    checks: string[] = [];
  let attempted = false;
  let failure: unknown;
  try {
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 3, background: '#123456' },
    })
      .webp()
      .toBuffer();
    attempted = true;
    await client.send(
      new PutObjectCommand({ Bucket, Key, Body: bytes, ContentType: 'image/webp' }),
    );
    checks.push('signed-upload');
    const downloaded = await client.send(new GetObjectCommand({ Bucket, Key }));
    if (
      !downloaded.Body ||
      !Buffer.from(await downloaded.Body.transformToByteArray()).equals(bytes) ||
      downloaded.ContentType !== 'image/webp'
    )
      throw new Error('Stored image content or MIME differs');
    checks.push('signed-read-integrity');
    const listed = await client.send(new ListObjectsV2Command({ Bucket, Prefix: Key, MaxKeys: 2 }));
    if (!listed.Contents?.some((object) => object.Key === Key))
      throw new Error('Probe missing from inventory');
    checks.push('signed-inventory');
    const bucketUrl = endpoint.href.replace(/\/$/, '') + '/' + encodeURIComponent(Bucket);
    for (const url of [bucketUrl + '/' + Key, bucketUrl + '?list-type=2&prefix=' + Key]) {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      await response.body?.cancel();
      if (![401, 403, 404].includes(response.status))
        throw new Error('Anonymous storage access was not denied');
    }
    checks.push('anonymous-object-and-list-denied');
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
    try {
      const remaining = await client.send(new GetObjectCommand({ Bucket, Key }));
      await remaining.Body?.transformToByteArray();
      throw new Error('Deleted probe remains readable');
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode !== 404)
        throw error;
    }
    checks.push('deleted-object-not-found');
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (attempted) await client.send(new DeleteObjectCommand({ Bucket, Key }));
    } catch {
      // A random probe key is safe to disclose to the authorized operator; no credentials are logged.
      console.error('Probe cleanup failed; inspect only this generated key: ' + Key);
      failure = new Error('Storage probe cleanup failed');
    } finally {
      client.destroy();
    }
  }
  if (failure) throw failure;
  return checks;
}

if (require.main === module) {
  void verifyStorage(process.env).then(
    (checks) => console.log(JSON.stringify({ storageVerification: 'passed', checks })),
    () => {
      console.error(
        'Storage verification failed. Check TLS, scoped permissions and private-bucket settings; credentials were not logged.',
      );
      process.exitCode = 1;
    },
  );
}
