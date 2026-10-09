/** Whether the catalogue knows the title, asked before a hold is placed on it. */
export const titleExists = async (isbn: string): Promise<boolean> => {
  const response = await fetch(`https://catalogue.library.example/titles/${isbn}`);
  return response.ok;
};
