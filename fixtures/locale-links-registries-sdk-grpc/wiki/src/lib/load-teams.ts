import flow from 'lodash/flow';
import { getJson } from './http';

/** Reads a list and keeps its items: the module's default, made by a composition. */
export default flow(getJson, (answer: Promise<{ items: unknown[] }>) => answer.then((body) => body.items));
