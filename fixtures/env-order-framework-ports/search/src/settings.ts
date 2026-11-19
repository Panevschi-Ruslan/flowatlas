const defaults = { port: 3200, index: 'products' };

/** The search settings, kept on the instance and merged by `load`. */
export class Settings {
  private values: Record<string, any> = defaults;

  load(given: Record<string, any>) {
    this.values = { ...this.values, ...given };
  }

  get() {
    return this.values;
  }
}
