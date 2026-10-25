import { DynamicModule, Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { MediaStorage } from './media-storage';
import { MediaLibraryService } from './media-library.service';
import { CharacterMediaService } from './character-media.service';
import { CharacterMediaController } from './character-media.controller';
import { ContentAccessService } from '../guides/services/content-access.service';
@Module({})
export class MediaModule {
  static register(db: DataSource): DynamicModule {
    return {
      module: MediaModule,
      controllers: [MediaController, CharacterMediaController],
      providers: [
        { provide: DataSource, useValue: db },
        ContentAccessService,
        MediaService,
        MediaLibraryService,
        CharacterMediaService,
        MediaStorage,
      ],
      exports: [MediaService],
    };
  }
}
