export interface Review {
  score: number;
  body: string;
}

const reviews = new Map<string, Review[]>();

export const reviewsOf = (id: string): Review[] => reviews.get(id) ?? [];

export const ratingOf = (id: string): number | null => {
  const found = reviewsOf(id);
  return found.length === 0 ? null : found.reduce((sum, review) => sum + review.score, 0) / found.length;
};

export const topRated = (): Array<{ id: string }> => [...reviews.keys()].map((id) => ({ id }));
