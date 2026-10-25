import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { parseEnvironment } from './config/env';
import { configureHttp } from './common/http/configure-http';
import { createDataSource } from './database/data-source';
import { configureSwagger } from './common/swagger/swagger.config';

async function bootstrap(): Promise<void> {
  const env = parseEnvironment(process.env);
  const db = createDataSource(env);
  await db.initialize();
  try {
    if (await db.showMigrations()) throw new Error('Run migrations before starting the API');
    const app = await NestFactory.create(AppModule.register(db, env), {
      bodyParser: false,
      abortOnError: false,
    });
    configureHttp(app, env);
    app.enableShutdownHooks();
    app.getHttpAdapter().getInstance().disable('x-powered-by');
    configureSwagger(app, env.NODE_ENV);
    await app.listen(env.PORT);
  } catch (error) {
    if (db.isInitialized) await db.destroy();
    throw error;
  }
}
void bootstrap().catch(() => {
  console.error('API startup failed; verify configuration and database availability');
  process.exitCode = 1;
});
