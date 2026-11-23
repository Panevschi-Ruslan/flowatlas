import { Injectable } from '@nestjs/common';

/** The method asked about: which ways in could break if it changes. */
@Injectable()
export class ItemsService {
  async findOne(id: string): Promise<{ id: string; title: string }> {
    return { id, title: 'an item' };
  }
}
