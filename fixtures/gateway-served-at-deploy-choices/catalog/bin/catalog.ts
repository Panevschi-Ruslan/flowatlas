import { App } from 'aws-cdk-lib';
import { CatalogStack } from '../lib/catalog-stack';

const app = new App();

// `cdk deploy -c stage=...` picks the stage, `beta` where nothing does; the
// region is `cdk.json`'s, which `-c region=...` overrides.
const stage = app.node.tryGetContext('stage') ?? 'beta';

new CatalogStack(app, 'CatalogStack', { env: { region: app.node.tryGetContext('region') }, stage });
