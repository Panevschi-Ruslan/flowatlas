import { Injectable } from '@nestjs/common';
import { LegacyRepository } from '../db/legacy.repository.js';

export interface AuditEntry { _id: string; at: string }

@Injectable()
export class AuditRepository extends LegacyRepository<AuditEntry> {
  protected readonly source = 'audit';
}
