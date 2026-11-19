import shared from './lint/shared.js';

export default [
  // Ignored for every object: nothing below vendor/ is linted.
  { ignores: ['vendor/'] },
  ...shared,
];
