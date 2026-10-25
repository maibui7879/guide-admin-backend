import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { mkdir, readFile, writeFile, unlink, opendir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type { S3Client } from '@aws-sdk/client-s3';
@Injectable()
export class MediaStorage {
  private client?: S3Client;
  onModuleDestroy(): void {
    this.client?.destroy();
  }
  private readonly root = resolve(
    process.env.MEDIA_LOCAL_DIR ?? resolve(__dirname, '../../../../../.data/media'),
  );
  private readonly driver =
    process.env.MEDIA_STORAGE_DRIVER ?? (process.env.NODE_ENV === 'production' ? 's3' : 'local');
  constructor() {
    if (!['local', 's3'].includes(this.driver)) throw new Error('Invalid media storage driver');
    if (process.env.NODE_ENV === 'production' && this.driver !== 's3')
      throw new Error('Production media requires S3 storage');
  }
  private async s3() {
    const sdk = await import('@aws-sdk/client-s3');
    this.client ??= new sdk.S3Client({
      endpoint: process.env.STORAGE_ENDPOINT,
      region: process.env.STORAGE_REGION,
      forcePathStyle: true,
      maxAttempts: 2,
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY ?? '',
        secretAccessKey: process.env.STORAGE_SECRET_KEY ?? '',
      },
      requestHandler: { connectionTimeout: 3000, requestTimeout: 15000 },
    });
    return {
      client: this.client,
      PutObjectCommand: sdk.PutObjectCommand,
      GetObjectCommand: sdk.GetObjectCommand,
      DeleteObjectCommand: sdk.DeleteObjectCommand,
      ListObjectsV2Command: sdk.ListObjectsV2Command,
    };
  }
  private path(key: string) {
    if (!/^[a-f0-9-]{36}\.webp$/.test(key)) throw new Error('Invalid storage key');
    return join(this.root, key);
  }
  async put(key: string, bytes: Buffer) {
    this.path(key);
    try {
      if (this.driver === 's3') {
        const { client, PutObjectCommand } = await this.s3();
        await client.send(
          new PutObjectCommand({
            Bucket: process.env.STORAGE_BUCKET,
            Key: key,
            Body: bytes,
            ContentType: 'image/webp',
          }),
        );
      } else {
        await mkdir(this.root, { recursive: true });
        await writeFile(this.path(key), bytes, { flag: 'wx' });
      }
    } catch {
      throw new ServiceUnavailableException('Image storage is unavailable');
    }
  }
  async get(key: string): Promise<Buffer> {
    this.path(key);
    if (this.driver === 's3') {
      const { client, GetObjectCommand } = await this.s3();
      const response = await client.send(
        new GetObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }),
      );
      if (!response.Body) throw new Error('Image missing');
      return Buffer.from(await response.Body.transformToByteArray());
    }
    return readFile(this.path(key));
  }
  async remove(key: string) {
    this.path(key);
    if (this.driver === 's3') {
      const { client, DeleteObjectCommand } = await this.s3();
      await client.send(new DeleteObjectCommand({ Bucket: process.env.STORAGE_BUCKET, Key: key }));
    } else {
      try {
        await unlink(this.path(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  async *inventory(): AsyncGenerator<{ key: string; lastModified: Date | null; byteSize: number }> {
    if (this.driver === 's3') {
      const { client, ListObjectsV2Command } = await this.s3();
      let token: string | undefined;
      do {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: process.env.STORAGE_BUCKET,
            MaxKeys: 1000,
            ContinuationToken: token,
          }),
        );
        for (const item of result.Contents ?? [])
          if (item.Key)
            yield {
              key: item.Key,
              lastModified: item.LastModified ?? null,
              byteSize: item.Size ?? 0,
            };
        token = result.IsTruncated ? result.NextContinuationToken : undefined;
        if (result.IsTruncated && !token) throw new Error('Incomplete storage inventory');
      } while (token);
      return;
    }
    let directory;
    try {
      directory = await opendir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for await (const entry of directory) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.webp$/.test(entry.name)) continue;
      try {
        const info = await stat(this.path(entry.name));
        yield { key: entry.name, lastModified: info.mtime, byteSize: info.size };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
}
