import shop from 'eslint-plugin-shop';
import { browser } from './lint/shared.js';

export default [
  browser,
  { plugins: { shop }, extends: ['shop/flat/browser'] },
];
