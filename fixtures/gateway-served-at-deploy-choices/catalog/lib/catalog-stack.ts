import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

export interface CatalogStackProps extends StackProps {
  readonly stage: string;
}

/** The products on sale, as a REST API deployed to the stage the app is handed. */
export class CatalogStack extends Stack {
  constructor(scope: Construct, id: string, props: CatalogStackProps) {
    super(scope, id, props);

    const listProducts = new NodejsFunction(this, 'ListProducts', {
      functionName: 'shop-list-products',
      entry: path.join(__dirname, '..', 'src', 'list-products.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });

    const api = new apigateway.RestApi(this, 'Catalog', { restApiName: 'shop-catalog', deployOptions: { stageName: props.stage } });
    api.root.addResource('products').addMethod('GET', new apigateway.LambdaIntegration(listProducts));
  }
}
