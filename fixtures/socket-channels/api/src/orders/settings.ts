/**
 * Names the deployment supplies, which the build has no way of knowing.
 *
 * Both are here so the two halves of the same problem stay together: an event
 * name nobody can read, and an endpoint nobody can read. Neither may be guessed
 * at, and each is reported at every call site that needed it.
 */
declare const settings: {
  readonly auditEvent: string;
  readonly reportsNamespace: string;
};

export const AUDIT_EVENT = settings.auditEvent;

export const REPORTS_NAMESPACE = settings.reportsNamespace;
