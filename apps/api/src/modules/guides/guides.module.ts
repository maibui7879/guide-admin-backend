import { DynamicModule, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditModule } from '../audit/audit.module';
import { AdminContentsController } from './controllers/admin-contents.controller';
import { GuidesController } from './controllers/guides.controller';
import { ContentAccessService } from './services/content-access.service';
import { ContentReaderService } from './services/content-reader.service';
import { ContentWriterService } from './services/content-writer.service';
import { MediaModule } from '../media/media.module';

@Module({})
export class GuidesModule {
  static register(db: DataSource): DynamicModule {
    return {
      module: GuidesModule,
      imports: [AuditModule, MediaModule.register(db)],
      controllers: [AdminContentsController, GuidesController],
      providers: [
        { provide: DataSource, useValue: db },
        ContentAccessService,
        ContentReaderService,
        ContentWriterService,
      ],
    };
  }
}
