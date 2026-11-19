import * as path from 'path';
import { Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import type { Construct } from 'constructs';

/** The products on sale, as a REST API deployed to the stage the stack keeps. */
export class CatalogStack extends Stack {
  private readonly stage: string;

  constructor(scope: Construct, id: string, props: StackProps, stage: string = 'beta') {
    super(scope, id, props);
    this.stage = stage;
    this.addApi();
  }

  private addApi(): void {
    const listProducts = new NodejsFunction(this, 'ListProducts', {
      functionName: 'shop-list-products',
      entry: path.join(__dirname, '..', 'src', 'list-products.ts'),
      runtime: lambda.Runtime.NODEJS_20_X,
    });
    const api = new apigateway.RestApi(this, 'Catalog', { restApiName: 'shop-catalog', deployOptions: { stageName: this.stage } });
    api.root.addResource('products').addMethod('GET', new apigateway.LambdaIntegration(listProducts));
  }
}
