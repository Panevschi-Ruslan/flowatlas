import { Injectable } from '@nestjs/common';

/** No data layer here: what this fixture is about is the way in, not the far end. */
@Injectable()
export class OrdersService {
  findOne(id: string): { id: string } {
    return { id };
  }

  rename(id: string, name: string): { id: string; name: string } {
    return { id, name };
  }
}
