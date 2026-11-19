import * as cdk from 'aws-cdk-lib';
import { ClubStack } from '../lib/club-stack';

const app = new cdk.App();

new ClubStack(app, 'ClubStack', { stage: app.node.tryGetContext('stage') });
