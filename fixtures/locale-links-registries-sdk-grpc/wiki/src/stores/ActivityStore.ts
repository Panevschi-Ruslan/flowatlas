/** One line of the activity feed. */
export interface Activity {
  readonly id: string;
  readonly text: string;
}

/** The activity feed, kept for the screens that show it. */
export class ActivityStore {
  items: Activity[] = [];

  /** Reads the feed: a request written in the method's own body. */
  async load() {
    const res = await fetch('/api/activity');
    this.items = await res.json();
  }

  /** Takes one line out. */
  remove = async (id: string) => {
    await fetch(`/api/activity/${id}`, { method: 'DELETE' });
    this.items = this.items.filter((item) => item.id !== id);
  };
}

export const activity = new ActivityStore();
