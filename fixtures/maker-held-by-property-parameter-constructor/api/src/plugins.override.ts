import { Router } from 'express';

import { plugins } from './plugins.routes';

/** A write from outside the object's module. */
export const resetPlugins = () => {
  plugins.router = Router();
};
