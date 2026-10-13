import type { Rental, Receipt, Station } from './types';

const rentals = new Map<string, Rental>();

export const startRental = async (riderId: string, stationId: string): Promise<Rental | undefined> => {
  if (stationId === '') return undefined;
  const rental: Rental = { rentalId: `${riderId}-${Date.now()}`, riderId, bikeId: 'b1', startedAt: new Date().toISOString() };
  rentals.set(rental.rentalId, rental);
  return rental;
};

export const findRental = async (rentalId: string): Promise<Rental | undefined> => rentals.get(rentalId);

export const endRental = async (rentalId: string): Promise<Receipt> => ({ rentalId, minutes: 12, charge: 1.5 });

export const allStations = async (): Promise<Station[]> => [{ stationId: 's1', name: 'Harbour', bikesFree: 4 }];
