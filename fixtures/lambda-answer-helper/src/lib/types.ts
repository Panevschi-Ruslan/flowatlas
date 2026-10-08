export interface StartRental {
  riderId: string;
  stationId: string;
}

export interface EndRental {
  stationId: string;
}

export interface Rental {
  rentalId: string;
  riderId: string;
  bikeId: string;
  startedAt: string;
}

export interface Receipt {
  rentalId: string;
  minutes: number;
  charge: number;
}

export interface Station {
  stationId: string;
  name: string;
  bikesFree: number;
}

export interface Refusal {
  reason: string;
}

/** Statuses the scheme answers with, by name. */
export enum Status {
  Ok = 200,
  Created = 201,
  NotFound = 404,
}
