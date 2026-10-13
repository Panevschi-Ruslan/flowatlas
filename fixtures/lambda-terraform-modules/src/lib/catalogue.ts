export interface Title {
  isbn: string;
  title: string;
  copies: number;
}

const titles = new Map<string, Title>();

export const findTitle = async (isbn: string): Promise<Title | undefined> => titles.get(isbn);

export const searchTitles = async (text: string): Promise<Title[]> =>
  [...titles.values()].filter((title) => title.title.toLowerCase().includes(text.toLowerCase()));
