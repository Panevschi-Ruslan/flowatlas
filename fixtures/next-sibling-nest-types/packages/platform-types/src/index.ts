import { Injectable } from '@nestjs/common';

export interface BookingOutput {
  id: number;
  title: string;
}

/** A DTO helper written for the Nest side of the platform, and imported by the web app too. */
@Injectable()
export class BookingOutputMapper {
  map(input: { id: number; title: string }): BookingOutput {
    return { id: input.id, title: input.title };
  }
}

export const toBookingOutput = (input: { id: number; title: string }): BookingOutput =>
  new BookingOutputMapper().map(input);
