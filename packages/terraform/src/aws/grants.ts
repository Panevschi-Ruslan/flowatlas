import { grantedIn, isWildcardResource, kindsGranted, MANAGED_WRITE_POLICIES, managedPolicyName } from '@flowatlas/aws';
import type { DeployedGrant, DeployedKind } from '@flowatlas/core';
import { attributeOf } from '../hcl/ast.js';
import { evaluate } from '../eval/evaluate.js';
import { asText, type Instance, type Value } from '../eval/values.js';
import { argument, blocksNamed, entryOf, HOLE, listed, siteOf } from './arguments.js';
import { deployedOf, isBecause } from './deployed.js';
import type { ResourceReading } from './reading.js';

/**
 * What a function's role lets it send to, write to, invoke or start, as
 * Terraform writes it (P272): the role `role` points at, the policies written
 * in it (`inline_policy`), the policies attached to it (`aws_iam_role_policy`,
 * `aws_iam_role_policy_attachment`, `aws_iam_policy_attachment`,
 * `managed_policy_arns`), and each policy's statements - a document a data
 * source builds (`data.aws_iam_policy_document`) or one `jsonencode` writes.
 * The actions say which kinds of thing a statement writes to, and each
 * resource is one thing by name, every one of its kind, or a resource not read.
 */

type Reading = Pick<ResourceReading, 'functionIndex' | 'ofType'>;

/** The instance a value refers to, as a reference or through the argument it was read from. */
const targetOf = (value: Value | undefined): Instance | undefined => {
  if (value === undefined) return undefined;
  if (value.kind === 'ref') return value.target;
  if (value.kind === 'instance') return value.instance;
  return 'via' in value ? value.via?.target : undefined;
};

/** What a value is as a list of texts: one, or each of a list. */
const texts = (value: Value | undefined): string[] => listed(value).flatMap((item) => {
  const text = asText(item);
  return text === undefined ? [] : [text];
});

/** What one resource of a statement grants of one kind. */
const resourceGrant = (kind: DeployedKind, value: Value, reading: Reading): Omit<DeployedGrant, 'by' | 'file' | 'line'> | undefined => {
  const found = deployedOf(value, reading);
  if (found !== undefined && !isBecause(found) && !isWildcardResource(found.name)) return found.kind === kind && found.changes !== true ? { kind, name: found.name } : undefined;
  const text = asText(value);
  if (text !== undefined) {
    const granted = grantedIn(kind, text);
    return granted === undefined ? undefined : { kind, ...granted };
  }
  // A string with a part not known - the account, the region - grants what its written parts say.
  const partial = value.kind === 'unknown' && value.template !== undefined ? value.template.map((piece) => (typeof piece === 'string' ? piece : (asText(piece) ?? HOLE))).join('') : undefined;
  if (partial !== undefined) {
    const granted = grantedIn(kind, partial.split(HOLE).join('\u0006'));
    if (granted === undefined) return undefined;
    if ('name' in granted && !granted.name.includes('\u0006')) return { kind, name: granted.name };
    if ('any' in granted) return { kind, any: partial.split(HOLE).join('…') };
  }
  const because = found !== undefined && isBecause(found) ? found.text : value.kind === 'unknown' ? value.because.text : 'it is not a resource this reads';
  return { kind, unread: because };
};

/** The grants of one statement, written as an object of its JSON (`Action`, `Resource`) or a document's block (`actions`, `resources`). */
const statementGrants = (statement: Value, reading: Reading, by: string, site: { file: string; line: number }): DeployedGrant[] => {
  const effect = asText(entryOf(statement, 'effect') ?? entryOf(statement, 'Effect') ?? { kind: 'null' });
  if (effect !== undefined && effect !== 'Allow') return [];
  const kinds = kindsGranted(texts(entryOf(statement, 'actions') ?? entryOf(statement, 'Action')));
  if (kinds.length === 0) return [];
  const out: DeployedGrant[] = [];
  for (const resource of listed(entryOf(statement, 'resources') ?? entryOf(statement, 'Resource'))) {
    for (const kind of kinds) {
      const grant = resourceGrant(kind, resource, reading);
      if (grant !== undefined) out.push({ ...grant, by, ...site });
    }
  }
  return out;
};

/** The statements of a policy, by the argument that holds it. */
const policyGrants = (holder: Instance, name: string, reading: Reading): DeployedGrant[] => {
  const site = siteOf(holder);
  const written = attributeOf(holder.block.body, name);
  // `jsonencode({ Statement = [...] })`: the object, before it is text.
  if (written !== undefined && written.expression.type === 'call' && written.expression.name === 'jsonencode' && written.expression.args[0] !== undefined) {
    const document = evaluate(written.expression.args[0], holder.module.scopeOf(holder));
    return listed(entryOf(document, 'Statement')).flatMap((statement, index) => statementGrants(statement, reading, `${holder.address}.${name}.Statement[${index}]`, site));
  }
  const value = argument(holder, name);
  const document = targetOf(value);
  if (document !== undefined && document.mode === 'data' && document.type === 'aws_iam_policy_document') {
    return blocksNamed(document, 'statement').flatMap((statement, index) => statementGrants(statement, reading, `${document.address}.statement[${index}]`, siteOf(document)));
  }
  // A policy written out as JSON text.
  const text = value === undefined ? undefined : asText(value);
  if (text !== undefined) {
    try {
      const parsed: unknown = JSON.parse(text);
      const statements = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['Statement'] : undefined;
      return (Array.isArray(statements) ? statements : statements === undefined ? [] : [statements]).flatMap((statement, index) =>
        statementGrants(jsonValue(statement), reading, `${holder.address}.${name}.Statement[${index}]`, site),
      );
    } catch {
      return [];
    }
  }
  return [];
};

/** A JSON value as an evaluated one. */
const jsonValue = (value: unknown): Value => {
  if (typeof value === 'string') return { kind: 'string', value };
  if (typeof value === 'number') return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (Array.isArray(value)) return { kind: 'list', items: value.map(jsonValue) };
  if (value !== null && typeof value === 'object') return { kind: 'object', entries: new Map(Object.entries(value).map(([key, item]) => [key, jsonValue(item)])) };
  return { kind: 'null' };
};

/** A policy attached by its ARN: one of AWS's that writes to everything of a kind, or a policy the configuration declares. */
const attachedGrants = (arn: Value | undefined, reading: Reading, by: string, site: { file: string; line: number }): DeployedGrant[] => {
  const policy = targetOf(arn);
  if (policy !== undefined && policy.type === 'aws_iam_policy') return policyGrants(policy, 'policy', reading);
  const text = arn === undefined ? undefined : asText(arn);
  const kinds = text === undefined ? undefined : MANAGED_WRITE_POLICIES[managedPolicyName(text)];
  return kinds === undefined ? [] : kinds.map((kind) => ({ kind, any: managedPolicyName(text as string), by, ...site }));
};

/** Whether a value refers to a role: a reference to it, or its name written out. */
const refersTo = (value: Value | undefined, role: Instance): boolean => {
  if (targetOf(value) === role) return true;
  const text = value === undefined ? undefined : asText(value);
  return text !== undefined && text === asText(argument(role, 'name') ?? { kind: 'null' });
};

/** Every grant of a role the configuration declares. */
const roleGrants = (role: Instance, reading: Reading): DeployedGrant[] => {
  const out: DeployedGrant[] = [];
  for (const block of blocksNamed(role, 'inline_policy')) {
    const policy = entryOf(block, 'policy');
    const document = targetOf(policy);
    if (document !== undefined && document.mode === 'data' && document.type === 'aws_iam_policy_document') {
      out.push(...blocksNamed(document, 'statement').flatMap((statement, index) => statementGrants(statement, reading, `${document.address}.statement[${index}]`, siteOf(document))));
    }
  }
  for (const arn of listed(argument(role, 'managed_policy_arns'))) out.push(...attachedGrants(arn, reading, `${role.address}.managed_policy_arns`, siteOf(role)));
  for (const policy of reading.ofType('managed', 'aws_iam_role_policy')) {
    if (refersTo(argument(policy, 'role'), role)) out.push(...policyGrants(policy, 'policy', reading));
  }
  for (const attachment of reading.ofType('managed', 'aws_iam_role_policy_attachment')) {
    if (refersTo(argument(attachment, 'role'), role)) out.push(...attachedGrants(argument(attachment, 'policy_arn'), reading, attachment.address, siteOf(attachment)));
  }
  for (const attachment of reading.ofType('managed', 'aws_iam_policy_attachment')) {
    if (listed(argument(attachment, 'roles')).some((each) => refersTo(each, role))) out.push(...attachedGrants(argument(attachment, 'policy_arn'), reading, attachment.address, siteOf(attachment)));
  }
  return out;
};

/** What a function the configuration declares is granted, through the role it runs as. */
export const functionGrants = (fn: Instance, reading: Reading): DeployedGrant[] => {
  const role = targetOf(argument(fn, 'role'));
  return role !== undefined && role.mode === 'managed' && role.type === 'aws_iam_role' ? roleGrants(role, reading) : [];
};
