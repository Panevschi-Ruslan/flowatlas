import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

export interface Record {
  id: string;
  kind: string;
  version: number;
}

/** One service every controller calls, so its throws stand behind every route. */
@Injectable()
export class ShopService {
  private readonly records = new Map<string, Record>();

  find(kind: string, id: string): Record {
    const found = this.records.get(`${kind}:${id}`);
    if (found === undefined) throw new NotFoundException(`${kind} ${id}`);
    return found;
  }

  save(kind: string, record: Record): Record {
    const was = this.records.get(`${kind}:${record.id}`);
    if (was !== undefined && was.version >= record.version) throw new ConflictException(`${kind} ${record.id} changed`);
    this.records.set(`${kind}:${record.id}`, record);
    return record;
  }

  load(kind: string, id: string): Record {
    const found = this.find(kind, id);
    return this.save(kind, { ...found, version: found.version + 1 });
  }
}
