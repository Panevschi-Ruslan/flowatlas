import { App } from 'aws-cdk-lib';
import { CatalogStack } from '../lib/catalog-stack';

const app = new App();

// `cdk deploy -c stage=...` picks the stage; the stack falls back to `beta`
// where nothing does. It is handed to the stack as an argument of its own.
const stage = app.node.tryGetContext('stage');

new CatalogStack(app, 'CatalogStack', { env: { region: 'eu-west-1' } }, stage);
