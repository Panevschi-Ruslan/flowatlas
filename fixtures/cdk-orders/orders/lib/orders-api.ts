import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration, WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface OrdersApiProps {
  readonly stage: string;
  readonly placeOrder: IFunction;
  readonly getOrder: IFunction;
  readonly cancelOrder: IFunction;
  readonly listOrders: IFunction;
  readonly liveSocket: IFunction;
}

/** The ways in over HTTP and a socket: a REST API, an HTTP API and the live orders socket. */
export class OrdersApi extends Construct {
  readonly rest: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: OrdersApiProps) {
    super(scope, id);

    this.rest = new apigateway.RestApi(this, 'Rest', { restApiName: `${props.stage}-orders` });
    const orders = this.rest.root.addResource('orders');
    orders.addMethod('POST', new apigateway.LambdaIntegration(props.placeOrder));
    const order = orders.addResource('{id}');
    order.addMethod('GET', new apigateway.LambdaIntegration(props.getOrder));
    order.addMethod('DELETE', new apigateway.LambdaIntegration(props.cancelOrder));

    const http = new apigwv2.HttpApi(this, 'Http', { apiName: `${props.stage}-orders` });
    http.addRoutes({
      path: '/orders',
      methods: [apigwv2.HttpMethod.GET],
      integration: new HttpLambdaIntegration('ListOrders', props.listOrders),
    });

    const live = new apigwv2.WebSocketApi(this, 'Live', {
      apiName: `${props.stage}-orders-websockets`,
      connectRouteOptions: { integration: new WebSocketLambdaIntegration('Connect', props.liveSocket) },
    });
    live.addRoute('subscribe', { integration: new WebSocketLambdaIntegration('Subscribe', props.liveSocket) });
  }
}
