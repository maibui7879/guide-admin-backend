import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { createApiDocument } from '../common/swagger/swagger.config';

async function run(): Promise<void> {
  // Documentation generation needs controller metadata, not database credentials or a connection.
  const app = await NestFactory.create(AppModule.register(new DataSource({ type: 'postgres' })), {
    logger: false,
    abortOnError: false,
  });
  try {
    const target = resolve(__dirname, '../../../../docs/openapi.json');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(createApiDocument(app), null, 2) + '\n');
    console.log('Exported docs/openapi.json without connecting to PostgreSQL');
  } finally {
    await app.close();
  }
}
void run().catch(() => {
  console.error('OpenAPI export failed');
  process.exitCode = 1;
});
