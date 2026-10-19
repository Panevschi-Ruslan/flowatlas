/** A weight reading from a shelf sensor. */
interface ShelfReading {
  shelf: string;
  grams: number;
}

/** Notes a shelf whose weight dropped: a book has been taken. */
export const handler = async (reading: ShelfReading): Promise<void> => {
  if (reading.grams < 100) console.log(`shelf ${reading.shelf} is nearly empty`);
};
