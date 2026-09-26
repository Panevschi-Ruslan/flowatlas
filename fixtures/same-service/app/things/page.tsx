import { createThing, deleteThing, listThings } from '../../lib/things-client';

/** The screen the edge starts at: three buttons and one relative address each. */
export default function ThingsPage() {
  return (
    <section>
      <button type="button" onClick={() => listThings()}>
        Refresh
      </button>
      <button type="button" onClick={() => createThing('new')}>
        Create
      </button>
      <button type="button" onClick={() => deleteThing('1')}>
        Delete
      </button>
    </section>
  );
}
