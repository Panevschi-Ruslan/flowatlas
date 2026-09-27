import { toBookingOutput } from '@sibling-types/platform-types';

/**
 * A Next.js route handler. The application has no bootstrap file and needs
 * none: nothing here is a Nest application, whatever a package it uses for
 * its DTOs is built with.
 */
export async function GET(): Promise<Response> {
  return Response.json([toBookingOutput({ id: 1, title: 'Intro call' })]);
}
