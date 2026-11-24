import type { ServiceSummary } from '@flowatlas/core';

/**
 * The service a tool's `service` input names (P377).
 *
 * An agent with one repository checked out says the repository's folder
 * (`shop-backend`), not the name the configuration gives the service
 * (`shop-api`); every tool answered that with "nothing matches". The folder
 * of a service's repository, as the configuration's `repo` writes it, is
 * accepted too, and so is a name in another case. A name that is none of
 * them answers the services there are, rather than an empty answer that
 * reads as "nothing there".
 */
export type ServiceNamed = { service: string } | { error: string; services: string[] };

/** The last folder of a path as a configuration writes it: `./repos/shop-backend/` is `shop-backend`. */
const folderOf = (repo: string): string => repo.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() ?? '';

/**
 * The service `said` names among `services`, or the error to answer with.
 * With no services recorded (a database written before they were), `said`
 * is taken as it is.
 */
export const serviceNamed = (services: readonly ServiceSummary[], said: string): ServiceNamed => {
  const names = services.map((service) => service.name);
  if (names.length === 0 || names.includes(said)) return { service: said };
  const wanted = said.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const lower = wanted.toLowerCase();
  const matches = (test: (service: ServiceSummary) => boolean): string[] => [...new Set(services.filter(test).map((service) => service.name))];
  for (const found of [
    matches((service) => service.name === wanted),
    matches((service) => typeof service.repo === 'string' && service.repo !== '' && (folderOf(service.repo) === folderOf(wanted) || service.repo.replace(/^\.\//, '') === wanted.replace(/^\.\//, ''))),
    matches((service) => service.name.toLowerCase() === lower),
    matches((service) => typeof service.repo === 'string' && service.repo !== '' && folderOf(service.repo).toLowerCase() === folderOf(lower)),
  ]) {
    if (found.length === 1) return { service: found[0]! };
    if (found.length > 1) return { error: `${JSON.stringify(said)} is the folder of several services; name one`, services: found.sort() };
  }
  return { error: `no service named ${JSON.stringify(said)}`, services: [...new Set(names)].sort() };
};
