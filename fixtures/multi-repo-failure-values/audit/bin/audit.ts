import { App } from 'aws-cdk-lib';
import { AuditStack } from '../lib/audit-stack';

const app = new App();

new AuditStack(app, 'shop-audit');
