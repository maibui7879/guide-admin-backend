import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { DataSource } from 'typeorm';
@Injectable()
export class DatabaseShutdown implements OnApplicationShutdown {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async onApplicationShutdown(): Promise<void> {
    if (this.db.isInitialized) await this.db.destroy();
  }
}
