export interface NewBook {
  isbn: string;
  title: string;
}

export interface Book extends NewBook {
  addedAt: string;
}

/** The topic a change of a book is published on, chosen at run time. */
export const topicFor = (change: string): string => `book.${change}`;
