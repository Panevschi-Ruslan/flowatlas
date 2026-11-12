import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

/** How many copies of each book are on the shelves, as a REST API deployed to the stage `live`. */
export class StockStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const countCopies = new NodejsFunction(this, 'CountCopies', {
      functionName: 'library-count-copies',
      entry: path.join(__dirname, '..', 'src', 'count-copies.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });

    // https://<id>.execute-api.eu-west-1.amazonaws.com/live/copies/{bookId}
    const api = new apigateway.RestApi(this, 'Stock', { restApiName: 'library-stock', deployOptions: { stageName: 'live' } });
    api.root.addResource('copies').addResource('{bookId}').addMethod('GET', new apigateway.LambdaIntegration(countCopies));
  }
}
