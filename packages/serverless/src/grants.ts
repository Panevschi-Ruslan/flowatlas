import { grantedIn, isWildcardResource, kindsGranted, MANAGED_WRITE_POLICIES, managedPolicyName } from '@flowatlas/aws';
import type { DeployedGrant, DeployedKind, PathStep } from '@flowatlas/core';
import { intrinsicOf, type Resource } from './cloudformation.js';
import type { FileReading } from './reading.js';
import { HOLE, isRecord, ParameterValue, textOf, Unread } from './variables.js';

/**
 * What a function's role lets it send to, write to, invoke or start, as a
 * CloudFormation template or a service file writes it (P272).
 *
 * A statement allows actions on resources; the actions say which kinds of
 * thing it writes to (`WRITE_ACTIONS`), and each resource is one thing of a
 * kind by name - a reference, an ARN written out or built around one - or
 * every one of it (`*`, an ARN ending in `*`), or a resource not read. A role
 * is its own policies, the managed policies it names and every policy that
 * names it among its roles. A statement that denies, or allows everything but
 * some actions, grants nothing read here.
 */

/** What stands for a part of an ARN that is not read while it is asked what it grants: no wildcard, and no name. */
const UNWRITTEN = '\u0006';

/** A value written as one item or as a list of them. */
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);

/** What one resource of a statement grants of one kind. */
const resourceGrant = (reading: FileReading, kind: DeployedKind, value: unknown): Omit<DeployedGrant, 'by' | 'file' | 'line'> | undefined => {
  const text = textOf(value);
  if (text !== undefined) {
    const granted = grantedIn(kind, text);
    return granted === undefined ? undefined : { kind, ...granted };
  }
  // A parameter with no value that names one thing this deployment declares (P268).
  if (value instanceof ParameterValue) {
    const named = reading.template.namedByParameter(value);
    if (named !== undefined && named.kind === kind) return { kind, name: named.name };
    return { kind, unread: value.text };
  }
  const found = reading.template.deployedOf(value);
  // A name that is a wildcard is every one of its kind, said below as it is written.
  if (found !== undefined && !(found instanceof Unread) && !isWildcardResource(found.name)) {
    if (found.kind !== kind || found.changes === true) return undefined;
    return { kind, name: found.name };
  }
  // An ARN built of parts some of which are not read - a region, an account -
  // grants what its written parts say: one thing where its name is written,
  // every one of the kind where the name is a wildcard written out.
  const built = intrinsicOf(value) === undefined ? undefined : reading.template.text(value);
  if (typeof built === 'string') {
    const granted = grantedIn(kind, built);
    return granted === undefined ? undefined : { kind, ...granted };
  }
  if (built?.partial !== undefined) {
    const granted = grantedIn(kind, built.partial.split(HOLE).join(UNWRITTEN));
    if (granted === undefined) return undefined;
    if ('name' in granted && !granted.name.includes(UNWRITTEN)) return { kind, name: granted.name };
    if ('any' in granted) return { kind, any: built.partial.split(HOLE).join('…') };
  }
  const because = found instanceof Unread ? found : value instanceof Unread ? value : built instanceof Unread ? built : new Unread('it is not text');
  return { kind, unread: because.text };
};

/** The grants of a list of statements, written at `path`, each said to be granted by `by` and its position. */
export const statementGrants = (reading: FileReading, statements: unknown, path: readonly PathStep[], by: string): DeployedGrant[] => {
  const out: DeployedGrant[] = [];
  listOf(statements).forEach((statement, index) => {
    if (!isRecord(statement)) return;
    const effect = textOf(statement['Effect']) ?? textOf(statement['effect']);
    if (effect !== undefined && effect !== 'Allow') return;
    const actions = listOf(statement['Action'] ?? statement['action']).map(textOf).filter((action): action is string => action !== undefined);
    const kinds = kindsGranted(actions);
    if (kinds.length === 0) return;
    const at = Array.isArray(statements) ? [...path, index] : [...path];
    const site = reading.siteOf(at);
    const named = `${by}${Array.isArray(statements) ? `[${index}]` : ''}`;
    for (const resource of listOf(statement['Resource'] ?? statement['resource'])) {
      for (const kind of kinds) {
        const grant = resourceGrant(reading, kind, resource);
        if (grant !== undefined) out.push({ ...grant, by: named, ...site });
      }
    }
  });
  return out;
};

/** The grants of a policy document: its statements. */
export const documentGrants = (reading: FileReading, document: unknown, path: readonly PathStep[], by: string): DeployedGrant[] =>
  isRecord(document) ? statementGrants(reading, document['Statement'], [...path, 'Statement'], `${by}.Statement`) : [];

/**
 * A managed policy by its name or ARN: one of AWS's that writes to every one
 * of a kind, or a policy the template declares, by a reference; nothing for
 * any other, whose statements are not in the files.
 */
export const managedGrants = (reading: FileReading, value: unknown, path: readonly PathStep[], by: string): DeployedGrant[] => {
  const text = textOf(value) ?? (() => {
    const built = intrinsicOf(value) === undefined ? undefined : reading.template.text(value);
    return built instanceof Unread ? built.partial : built;
  })();
  if (text !== undefined) {
    const name = managedPolicyName(text);
    const kinds = MANAGED_WRITE_POLICIES[name];
    if (kinds !== undefined) return kinds.map((kind) => ({ kind, any: name, by, ...reading.siteOf(path) }));
  }
  const ref = intrinsicOf(value);
  const resource = ref?.[0] === 'Ref' && typeof ref[1] === 'string' ? reading.template.resources.get(ref[1]) : undefined;
  if (resource?.type === 'AWS::IAM::ManagedPolicy') return documentGrants(reading, resource.properties['PolicyDocument'], [...resource.path, 'Properties', 'PolicyDocument'], resource.address);
  return [];
};

/** The logical id a value refers to a role by: `!GetAtt Role.Arn`, `!Ref Role`, or the role's logical id written out. */
export const roleOf = (reading: FileReading, value: unknown): Resource | undefined => {
  const ref = intrinsicOf(value);
  let id: string | undefined;
  if (ref?.[0] === 'Ref' && typeof ref[1] === 'string') id = ref[1];
  else if (ref?.[0] === 'Fn::GetAtt') id = Array.isArray(ref[1]) ? textOf(ref[1][0]) : textOf(ref[1])?.split('.')[0];
  else id = textOf(value);
  const resource = id === undefined ? undefined : reading.template.resources.get(id);
  return resource?.type === 'AWS::IAM::Role' ? resource : undefined;
};

/** Whether a list of roles a policy is attached to names a role. */
const namesRole = (roles: unknown, role: Resource): boolean =>
  listOf(roles).some((item) => {
    const ref = intrinsicOf(item);
    return (ref?.[0] === 'Ref' && ref[1] === role.logicalId) || textOf(item) === textOf(role.properties['RoleName']);
  });

/**
 * What a function of a service file is granted (P272): the role it names
 * (`role`), else the statements written for it alone (`iamRoleStatements`,
 * as the per-function roles plugin reads them, with the provider's where it
 * says to inherit them), else the provider's - `provider.iam.role`, its
 * statements and managed policies, or the older `iamRoleStatements` and
 * `iamManagedPolicies` - which every function of the service shares.
 */
export const serviceFunctionGrants = (reading: FileReading, fn: Record<string, unknown>, path: readonly PathStep[], provider: Record<string, unknown>): DeployedGrant[] => {
  const own = fn['role'] === undefined ? undefined : roleOf(reading, fn['role']);
  if (own !== undefined) return roleGrants(reading, own);
  const providerGrants = (): DeployedGrant[] => {
    const iam = isRecord(provider['iam']) ? provider['iam'] : {};
    const role = iam['role'] ?? provider['role'];
    // A role of its own, named rather than described: its policies are the template's.
    if (role !== undefined && (!isRecord(role) || intrinsicOf(role) !== undefined)) {
      const custom = roleOf(reading, role);
      return custom === undefined ? [] : roleGrants(reading, custom);
    }
    const declared = isRecord(role) ? role : {};
    const statements: { at: PathStep[]; value: unknown } =
      declared['statements'] !== undefined ? { at: ['provider', 'iam', 'role', 'statements'], value: declared['statements'] } : { at: ['provider', 'iamRoleStatements'], value: provider['iamRoleStatements'] };
    const managed: { at: PathStep[]; value: unknown } =
      declared['managedPolicies'] !== undefined ? { at: ['provider', 'iam', 'role', 'managedPolicies'], value: declared['managedPolicies'] } : { at: ['provider', 'iamManagedPolicies'], value: provider['iamManagedPolicies'] };
    return [
      ...statementGrants(reading, statements.value, statements.at, statements.at.join('.')),
      ...listOf(managed.value).flatMap((arn, index) => managedGrants(reading, arn, [...managed.at, index], `${managed.at.join('.')}[${index}]`)),
    ];
  };
  if (fn['iamRoleStatements'] !== undefined) {
    const mine = statementGrants(reading, fn['iamRoleStatements'], [...path, 'iamRoleStatements'], `${path.join('.')}.iamRoleStatements`);
    return fn['iamRoleStatementsInherit'] === true ? [...mine, ...providerGrants()] : mine;
  }
  return providerGrants();
};

/** Everything a role the template declares grants: its own policies, its managed ones, and each policy attached to it. */
export const roleGrants = (reading: FileReading, role: Resource): DeployedGrant[] => {
  const out: DeployedGrant[] = [];
  listOf(role.properties['Policies']).forEach((policy, index) => {
    if (!isRecord(policy)) return;
    out.push(...documentGrants(reading, policy['PolicyDocument'], [...role.path, 'Properties', 'Policies', index, 'PolicyDocument'], `${role.address}.Policies[${index}]`));
  });
  listOf(role.properties['ManagedPolicyArns']).forEach((arn, index) => {
    out.push(...managedGrants(reading, arn, [...role.path, 'Properties', 'ManagedPolicyArns', index], `${role.address}.ManagedPolicyArns[${index}]`));
  });
  for (const resource of reading.template.resources.values()) {
    if ((resource.type === 'AWS::IAM::Policy' || resource.type === 'AWS::IAM::ManagedPolicy') && namesRole(resource.properties['Roles'], role)) {
      out.push(...documentGrants(reading, resource.properties['PolicyDocument'], [...resource.path, 'Properties', 'PolicyDocument'], resource.address));
    }
  }
  return out;
};
