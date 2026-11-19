import { App } from 'aws-cdk-lib';
import { OrdersStack } from '../lib/orders-stack';

const app = new App();
const stage: string = app.node.tryGetContext('stage') ?? 'dev';

new OrdersStack(app, 'OrdersStack', { stage });
