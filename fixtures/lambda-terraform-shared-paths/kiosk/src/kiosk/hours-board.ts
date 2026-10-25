import { CallsService } from '@flowatlas/markers';

/**
 * Opening hours of the branch's desks. Two APIs answer `GET /hours`, and the
 * address of each request is built at run time, so an annotation says where
 * it goes; which of the two APIs it means is the setting's name, or nothing.
 */
export class HoursBoard {
  /** The setting names the lending desk, so the lending desk's API is taken. */
  @CallsService('branch', 'GET /hours')
  async deskHours(page: string): Promise<number> {
    const response = await fetch(`${process.env.DESK_HOURS_URL}/${page}`);
    return response.status;
  }

  /** No setting, and the service's name names neither API. */
  @CallsService('branch', 'GET /hours')
  async anyHours(base: string): Promise<number> {
    const response = await fetch(base);
    return response.status;
  }
}
