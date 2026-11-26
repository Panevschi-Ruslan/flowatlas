const seen: string[] = [];

export const stampRequest = (path: string): void => {
  seen.push(path);
};
