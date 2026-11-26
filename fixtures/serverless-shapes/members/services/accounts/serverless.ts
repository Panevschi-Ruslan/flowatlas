import { functions } from './functions';

const SERVICE = 'accounts';

/**
 * The accounts service, written in TypeScript: the same document a
 * `serverless.yml` holds, built from constants, an import and a spread.
 */
const serverlessConfiguration = {
  service: SERVICE,
  frameworkVersion: '3',
  provider: {
    name: 'aws',
    runtime: 'nodejs20.x',
    stage: "${opt:stage, 'dev'}",
    httpApi: { name: 'club-accounts' },
    environment: {
      LAPSED_TOPIC_ARN: { Ref: 'LapsedTopic' },
    },
  },
  functions,
  resources: {
    Resources: {
      LapsedTopic: {
        Type: 'AWS::SNS::Topic',
        Properties: { TopicName: '${self:service}-${sls:stage}-lapsed' },
      },
    },
  },
};

module.exports = serverlessConfiguration;
