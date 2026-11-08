import { App } from 'aws-cdk-lib';
import { StorageStack, WorkerStack } from '../lib/stacks';

const app = new App();

const storage = new StorageStack(app, 'reports-storage');
new WorkerStack(app, 'reports-worker', { jobs: storage.jobs });
