import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { AuditEntry, AuditEntryEntity } from './entities/audit-entry.entity';

@Injectable()
export class AuditService {
  async record(manager: EntityManager, entry: Omit<AuditEntry, 'id' | 'createdAt'>): Promise<void> {
    const repository = manager.getRepository(AuditEntryEntity);
    await repository.save(repository.create({ id: randomUUID(), ...entry }));
  }
}
