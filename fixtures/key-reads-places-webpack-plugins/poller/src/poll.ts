const CMS = 'http://localhost:4710';

/** The installed pins plugin, shipped as a webpack 5 bundle. */
export const pins = () => fetch(`${CMS}/api/pins/pins`).then((res) => res.json());
export const unpin = (id: string) => fetch(`${CMS}/api/pins/pins/${id}`, { method: 'DELETE' }).then((res) => res.json());

/** The installed maps plugin, shipped as a webpack 4 bundle. */
export const maps = () => fetch(`${CMS}/api/maps/maps`).then((res) => res.json());

/** The local notes plugin, a file: dependency of the application too. */
export const notes = () => fetch(`${CMS}/api/notes/notes`).then((res) => res.json());

/** The boards plugin, its controllers written whole over its own. */
export const cards = () => fetch(`${CMS}/api/boards/cards`).then((res) => res.json());
export const addCard = (body: unknown) => fetch(`${CMS}/api/boards/cards`, { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());
export const lanes = () => fetch(`${CMS}/api/boards/lanes`).then((res) => res.json());

/** The polls plugin, its controllers written as a fresh object. */
export const polls = () => fetch(`${CMS}/api/polls/cards`).then((res) => res.json());
export const pollLanes = () => fetch(`${CMS}/api/polls/lanes`).then((res) => res.json());
export const pollTags = () => fetch(`${CMS}/api/polls/tags`).then((res) => res.json());
export const addPoll = (body: unknown) => fetch(`${CMS}/api/polls/cards`, { method: 'POST', body: JSON.stringify(body) }).then((res) => res.json());
export const boardTags = () => fetch(`${CMS}/api/boards/tags`).then((res) => res.json());
