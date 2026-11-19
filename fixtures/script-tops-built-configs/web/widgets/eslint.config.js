import lint from 'shop-lint';
import extra from 'shop-extra-lint';

export default [
  lint.configs.widgets,
  { files: ['admin/**'], extends: [lint.configs.node] },
  extra.configs.browser,
  vendorLint.configs.browser,
];
