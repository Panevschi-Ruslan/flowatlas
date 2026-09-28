export class LevelFormat {
  format(level: number): string {
    return level === 0 ? 'out of stock' : `${level} in stock`;
  }
}
