import { App } from 'aws-cdk-lib';
import { StockStack } from '../lib/stock-stack';

const app = new App();

new StockStack(app, 'StockStack', { env: { region: 'eu-west-1' } });
