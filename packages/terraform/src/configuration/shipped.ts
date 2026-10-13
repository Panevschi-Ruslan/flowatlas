import { infraModuleSchema, type InfraModuleConfig, type InfraModuleDescription } from '@flowatlas/core';
import { MESSAGING_MODULES } from './shipped-messaging.js';

/**
 * Descriptions of the public modules most projects declare functions, routes
 * and workflows through, shipped with the tool.
 *
 * Written in exactly the shape a person writes under `adapters.infra.modules`
 * and parsed by the same schema, so a field only configuration had ever used
 * cannot exist, and a project that needs a different reading of one of these
 * writes its own description with the same source: a configured description is
 * tried before a shipped one.
 *
 * Each describes what the module declares when it is called the way its README
 * calls it. What the module does with inputs nothing here reads - layers, roles,
 * log groups, domain names - is left out, because a description says where the
 * things this tool joins on are, not everything a module creates.
 */
const LAMBDA: InfraModuleDescription = {
  source: 'terraform-aws-modules/lambda/aws',
  variables: {
    create: 'true',
    create_function: 'true',
    create_layer: 'false',
    package_type: '"Zip"',
    environment_variables: '{}',
  },
  resources: {
    'aws_lambda_function.this': {
      count: 'var.create && var.create_function && !var.create_layer ? 1 : 0',
      function_name: 'var.function_name',
      handler: 'var.package_type != "Zip" ? null : var.handler',
      runtime: 'var.package_type != "Zip" ? null : var.runtime',
      package_type: 'var.package_type',
      filename: 'data.archive_file.source.output_path',
      environment: '{ variables = var.environment_variables }',
    },
    // `source_path` is a path, a list of paths, or a list of objects each with a
    // `path`; the first is the code the function runs.
    'data.archive_file.source': {
      source_dir: 'try(var.source_path[0].path, var.source_path[0], var.source_path)',
    },
  },
  outputs: {
    lambda_function_arn: 'try(aws_lambda_function.this[0].arn, "")',
    lambda_function_invoke_arn: 'try(aws_lambda_function.this[0].invoke_arn, "")',
    lambda_function_name: 'try(aws_lambda_function.this[0].function_name, "")',
    lambda_function_qualified_arn: 'try(aws_lambda_function.this[0].qualified_arn, "")',
    lambda_function_qualified_invoke_arn: 'try(aws_lambda_function.this[0].qualified_invoke_arn, "")',
  },
};

const HTTP_API: InfraModuleDescription = {
  source: 'terraform-aws-modules/apigateway-v2/aws',
  variables: {
    create: 'true',
    create_routes_and_integrations: 'true',
    protocol_type: '"HTTP"',
    routes: '{}',
    integrations: '{}',
  },
  resources: {
    'aws_apigatewayv2_api.this': {
      count: 'var.create ? 1 : 0',
      name: 'var.name',
      protocol_type: 'var.protocol_type',
    },
    // Version 5 and later: `routes`, keyed by route key, each with its integration.
    'aws_apigatewayv2_route.this': {
      for_each: 'var.create && var.create_routes_and_integrations ? var.routes : {}',
      api_id: 'aws_apigatewayv2_api.this[0].id',
      route_key: 'each.key',
      target: '"integrations/${aws_apigatewayv2_integration.this[each.key].id}"',
      authorization_type: 'try(each.value.authorization_type, null)',
    },
    'aws_apigatewayv2_integration.this': {
      for_each: 'var.create && var.create_routes_and_integrations ? var.routes : {}',
      api_id: 'aws_apigatewayv2_api.this[0].id',
      integration_type: 'try(each.value.integration.type, "AWS_PROXY")',
      integration_uri: 'try(each.value.integration.uri, null)',
    },
    // Versions before 5: `integrations`, keyed by route key, each naming its function.
    'aws_apigatewayv2_route.integrations': {
      for_each: 'var.create && var.create_routes_and_integrations ? var.integrations : {}',
      api_id: 'aws_apigatewayv2_api.this[0].id',
      route_key: 'each.key',
      target: '"integrations/${aws_apigatewayv2_integration.integrations[each.key].id}"',
      authorization_type: 'try(each.value.authorization_type, null)',
    },
    'aws_apigatewayv2_integration.integrations': {
      for_each: 'var.create && var.create_routes_and_integrations ? var.integrations : {}',
      api_id: 'aws_apigatewayv2_api.this[0].id',
      integration_type: 'try(each.value.integration_type, "AWS_PROXY")',
      integration_uri: 'try(each.value.lambda_arn, each.value.integration_uri, null)',
    },
  },
  outputs: {
    api_id: 'try(aws_apigatewayv2_api.this[0].id, "")',
    api_endpoint: 'try(aws_apigatewayv2_api.this[0].api_endpoint, "")',
    api_execution_arn: 'try(aws_apigatewayv2_api.this[0].execution_arn, "")',
  },
};

/**
 * A state machine, its definition handed over as the module's input: a
 * definition written as `templatefile(...)` in the call is read as one, with
 * its variables, because the reading follows `var.definition` back to it.
 */
const STEP_FUNCTIONS: InfraModuleDescription = {
  source: 'terraform-aws-modules/step-functions/aws',
  variables: {
    create: 'true',
    type: '"STANDARD"',
  },
  resources: {
    'aws_sfn_state_machine.this': {
      count: 'var.create ? 1 : 0',
      name: 'var.name',
      definition: 'var.definition',
      type: 'upper(var.type)',
    },
  },
  outputs: {
    state_machine_id: 'try(aws_sfn_state_machine.this[0].id, "")',
    state_machine_arn: 'try(aws_sfn_state_machine.this[0].arn, "")',
    state_machine_name: 'try(aws_sfn_state_machine.this[0].name, "")',
  },
};

/** The shipped descriptions, parsed by the schema configuration is parsed by. */
export const SHIPPED_MODULES: readonly InfraModuleConfig[] = [LAMBDA, HTTP_API, STEP_FUNCTIONS, ...MESSAGING_MODULES].map((description) =>
  infraModuleSchema.parse(description),
);
