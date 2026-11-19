export interface Review {
  score: number;
}

const reviews = new Map<string, Review[]>();

export const reviewsOf = (id: string): Review[] => reviews.get(id) ?? [];

export const topProducts = (): Array<{ id: string }> => [...reviews.keys()].map((id) => ({ id }));
