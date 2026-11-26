import { addServerHandler, addServerImportsDir, defineNuxtModule } from '@nuxt/kit';
import { fileURLToPath } from 'node:url';

const runtime = fileURLToPath(new URL('../server-audit', import.meta.url));

export default defineNuxtModule({
  meta: { name: 'audit' },
  setup() {
    // Names the server's routes call with no import.
    addServerImportsDir(`${runtime}/utils`);
    // In front of every route.
    addServerHandler({ middleware: true, handler: `${runtime}/stamp` });
    // A route written as code: not read.
    const auditRoute = process.env.AUDIT_ROUTE ?? '/api/stamp';
    addServerHandler({ route: auditRoute, handler: `${runtime}/stamp` });
  },
});
