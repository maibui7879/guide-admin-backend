import { DynamicModule, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CatalogController } from './controllers/catalog.controller';
import { CatalogService } from './services/catalog.service';
import { CatalogWriterService } from './services/catalog-writer.service';
import { AdminCatalogController } from './controllers/admin-catalog.controller';
@Module({})
export class CatalogModule {
  static register(db: DataSource): DynamicModule {
    return {
      module: CatalogModule,
      controllers: [CatalogController, AdminCatalogController],
      providers: [{ provide: DataSource, useValue: db }, CatalogService, CatalogWriterService],
      exports: [CatalogService, CatalogWriterService],
    };
  }
}
