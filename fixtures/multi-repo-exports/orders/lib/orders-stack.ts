import * as path from 'path';
import { CfnOutput, Fn, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * The orders service: its routes hang from the gateway's APIs, which it looks
 * up by what the gateway exports, and the queue it creates is exported for the
 * gateway and the catalog to read.
 */
export class OrdersStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const handler = (id: string, file: string, environment: Record<string, string> = {}): NodejsFunction =>
      new NodejsFunction(this, id, {
        functionName: `orders-${file}`,
        entry: path.join(__dirname, '..', 'src', `${file}.ts`),
        runtime: lambda.Runtime.NODEJS_20_X,
        environment,
      });

    const placed = new sqs.Queue(this, 'Placed', { queueName: 'orders-placed' });
    const placeOrder = handler('PlaceOrder', 'place-order', { PLACED_QUEUE_URL: placed.queueUrl });
    const getOrder = handler('GetOrder', 'get-order');
    const listOrders = handler('ListOrders', 'list-orders');
    const restock = handler('Restock', 'restock');

    // The shop's REST API, created by the gateway: POST /orders and GET /orders/{id} below its root.
    const api = apigateway.RestApi.fromRestApiAttributes(this, 'ShopApi', {
      restApiId: Fn.importValue('shop-rest-api-id'),
      rootResourceId: Fn.importValue('shop-rest-api-root'),
    });
    const orders = api.root.addResource('orders');
    orders.addMethod('POST', new apigateway.LambdaIntegration(placeOrder));
    orders.addResource('{id}').addMethod('GET', new apigateway.LambdaIntegration(getOrder));

    // The shop's HTTP API, created by the gateway too.
    const http = apigwv2.HttpApi.fromHttpApiAttributes(this, 'ShopHttp', { httpApiId: Fn.importValue('shop-http-api-id') });
    new apigwv2.HttpRoute(this, 'ListOrdersRoute', {
      httpApi: http,
      routeKey: apigwv2.HttpRouteKey.with('/orders', apigwv2.HttpMethod.GET),
      integration: new HttpLambdaIntegration('ListOrdersIntegration', listOrders),
    });

    // The catalog's topic, which says when a product is back in stock.
    const restocked = sns.Topic.fromTopicArn(this, 'Restocked', Fn.importValue('catalog-restock-topic-arn'));
    restocked.addSubscription(new subscriptions.LambdaSubscription(restock));

    new CfnOutput(this, 'PlacedQueueArn', { value: placed.queueArn, exportName: 'orders-placed-queue-arn' });
  }
}
