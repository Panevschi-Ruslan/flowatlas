import { App } from 'aws-cdk-lib';
import { OrdersStack } from '../lib/orders-stack';

const app = new App();

new OrdersStack(app, 'shop-orders');
