import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dirname, join, posix, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandsAround } from '@flowatlas/serverless';
import { readManifestsUnder, type ChartInstall } from './cluster.js';
import { readHelmfile } from './helmfile.js';
import { readHelmfileRuns, readHelmInstalls, readPortForwards } from './docker-run.js';
import { renderings, setValue, UNREAD_MARK, type ChartContext } from './helm.js';
import { readProjectSettings } from './read.js';

let root: string | undefined;
afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const project = (files: Record<string, string>): string => {
  root = mkdtempSync(join(tmpdir(), 'flowatlas-cluster-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
};

const lines = (...each: string[]): string => each.join('\n');

const context = (values: Record<string, unknown>, release: ChartContext['release'] = { name: 'orders' }): ChartContext => ({ values, release, chart: { name: 'orders', version: '0.1.0' } });

/** The one way a template renders, or what it renders as. */
const rendered = (source: string, values: Record<string, unknown>, release?: ChartContext['release']) => {
  const read = renderings(source, context(values, release));
  return read.kind === 'rendered' ? read.ways.map((way) => way.text) : read.why;
};

const DEPLOYMENT = (name: string, port: number, extra: string[] = []) =>
  lines(
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    `  name: ${name}`,
    'spec:',
    '  template:',
    '    metadata:',
    '      labels:',
    `        app: ${name}`,
    '    spec:',
    '      containers:',
    `        - name: ${name}`,
    `          image: registry.example.test/${name}:1.0`,
    '          ports:',
    '            - name: http',
    `              containerPort: ${port}`,
    ...extra,
  );

const SERVICE = (name: string, port: number, target: number | string, extra: string[] = []) =>
  lines('apiVersion: v1', 'kind: Service', 'metadata:', `  name: ${name}`, 'spec:', ...extra, '  selector:', `    app: ${name}`, '  ports:', `    - port: ${port}`, `      targetPort: ${target}`);

describe('a chart template rendered with its values (P260)', () => {
  it('looks values up, through defaults, pipelines and variables', () => {
    const source = lines(
      '{{- $port := .Values.service.port | default 8080 }}',
      'metadata:',
      '  name: {{ .Release.Name }}-{{ .Chart.Name }}',
      '  namespace: {{ .Release.Namespace | quote }}',
      'spec:',
      '  ports:',
      '    - port: {{ $port }}',
      '      targetPort: {{ .Values.service.targetPort | default "http" | quote }}',
      '      name: {{ printf "%s-%d" "web" 1 }}',
    );
    expect(rendered(source, { service: { port: 80 } }, { name: 'shop' })).toEqual([
      lines('', 'metadata:', '  name: shop-orders', `  namespace: ${UNREAD_MARK}`, 'spec:', '  ports:', '    - port: 80', '      targetPort: "http"', '      name: web-1'),
    ]);
  });

  it('decides a condition the values decide, and renders one nothing decides both ways', () => {
    const source = lines('{{- if .Values.ingress.enabled }}', 'kind: Ingress', '{{- else if .Capabilities.APIVersions }}', 'kind: Other', '{{- else }}', 'kind: None', '{{- end }}');
    expect(rendered(source, { ingress: { enabled: true } })).toEqual(['\nkind: Ingress']);
    expect(rendered(source, { ingress: { enabled: false } })).toEqual(['\nkind: Other', '\nkind: None']);
  });

  it('ranges over a list and a map, and includes a helper with its context', () => {
    const helpers = lines('{{- define "orders.name" -}}', '{{ .Chart.Name }}-api', '{{- end }}');
    const source = lines('name: {{ include "orders.name" . }}', 'ports:', '{{- range .Values.ports }}', '  - port: {{ .port }}', '{{- end }}', 'env:', '{{- range $key, $value := .Values.env }}', '  - name: {{ $key }}', '    value: {{ $value | quote }}', '{{- end }}');
    const read = renderings(`${helpers}\n${source}`, context({ ports: [{ port: 80 }, { port: 81 }], env: { PORT: 3000 } }));
    expect(read.kind === 'rendered' ? read.ways[0]?.text.trim() : read).toBe(lines('name: orders-api', 'ports:', '  - port: 80', '  - port: 81', 'env:', '  - name: PORT', '    value: "3000"'));
  });

  it('writes a value nothing gives as unread, keeps a line of its own, and says where a list nothing gives is ranged over', () => {
    const source = lines('labels:', '  {{- include "missing" . | nindent 2 }}', 'image: {{ lookup "v1" "Secret" "x" "y" }}');
    expect(rendered(source, {})).toEqual([lines('labels:', `  ${UNREAD_MARK}`, `image: ${UNREAD_MARK}`)]);
    expect(rendered('{{- range .Capabilities.APIVersions }}x{{ end }}', {})).toBe('it ranges over a value the files do not give');
  });

  it('keeps the template line each rendered line is written on', () => {
    const read = renderings(lines('a: 1', '{{- if true }}', 'b: {{ toYaml .Values.list | nindent 2 }}', '{{- end }}', 'c: 3'), context({ list: ['x', 'y'] }));
    expect(read.kind === 'rendered' ? read.ways[0]?.lines : read).toEqual([1, 3, 3, 3, 5]);
  });

  it('reads a --set over the values', () => {
    expect(setValue({ service: { port: 80, type: 'ClusterIP' } }, 'service.port=8080')).toEqual({ service: { port: 8080, type: 'ClusterIP' } });
    expect(setValue({}, 'list[0]=x')).toEqual({});
  });
});

/** The commands the shared reader finds in a repository of these files (P263). */
const commandsOf = (files: Record<string, string>) => commandsAround(project(files), '.');

describe('the commands a script runs against a cluster (P260)', () => {
  it('reads a chart installed with its values files, sets, release and namespace', () => {
    const make = lines('deploy:', '\thelm upgrade --install orders ./charts/orders \\', '\t  -f charts/orders/values-prod.yaml --set service.port=80 -n shop', 'render:', '\t@helm template ./charts/orders --values=a.yaml,b.yaml');
    const commands = commandsOf({ Makefile: make, 'package.json': JSON.stringify({ scripts: { deploy: 'helm install $RELEASE ./chart' } }) });
    expect(readHelmInstalls(commands)).toEqual([
      { chart: './chart', values: [], sets: [], line: 1, file: 'package.json', dirs: ['.'] },
      { release: 'orders', chart: './charts/orders', namespace: 'shop', values: ['charts/orders/values-prod.yaml'], sets: ['service.port=80'], line: 2, file: 'Makefile', dirs: ['.'] },
      { chart: './charts/orders', values: ['a.yaml', 'b.yaml'], sets: [], line: 5, file: 'Makefile', dirs: ['.'] },
    ]);
  });

  it('reads the ports a port-forward makes this machine reach, its namespace written anywhere (P263)', () => {
    const script = lines('kubectl port-forward svc/orders 8080:80 -n shop &', 'kubectl -n shop port-forward deploy/stock 4000', 'kubectl port-forward pod/x 1:2', 'kubectl port-forward svc/billing :80');
    expect(readPortForwards(commandsOf({ 'forward.sh': script }))).toEqual([
      { kind: 'service', name: 'orders', namespace: 'shop', local: 8080, remote: 80, line: 1, file: 'forward.sh' },
      { kind: 'workload', name: 'stock', namespace: 'shop', local: 4000, remote: 4000, line: 2, file: 'forward.sh' },
    ]);
  });
});

describe("what a cluster's manifests say, built as the tools that apply them build them (P260)", () => {
  it("renders a chart's templates with its values and the values its install command gives", () => {
    const dir = project({
      'orders/charts/orders/Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n',
      'orders/charts/orders/values.yaml': 'service:\n  port: 80\n  targetPort: 3000\n',
      'orders/charts/orders/values-prod.yaml': 'service:\n  port: 8080\n',
      'orders/charts/orders/templates/_helpers.tpl': '{{- define "orders.fullname" -}}\n{{ .Release.Name }}\n{{- end }}\n',
      'orders/charts/orders/templates/service.yaml': lines(
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: {{ include "orders.fullname" . }}',
        'spec:',
        '  type: {{ .Values.service.type | default "ClusterIP" }}',
        '  ports:',
        '    - port: {{ .Values.service.port }}',
        '      targetPort: {{ .Values.service.targetPort }}',
        '      {{- if eq .Values.service.type "NodePort" }}',
        '      nodePort: 30080',
        '      {{- end }}',
      ),
      'orders/Makefile': 'deploy:\n\thelm upgrade --install orders ./charts/orders -f ./charts/orders/values-prod.yaml --set service.type=NodePort\n',
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.routes).toEqual([
      { name: 'orders', names: ['orders'], file: 'charts/orders/templates/service.yaml', ports: [{ port: 8080, target: 3000, file: 'charts/orders/templates/service.yaml', line: 8 }], environment: {} },
    ]);
    // The node port the install's type opens is this machine's where the cluster runs on it.
    expect(read['orders']?.containers).toEqual([
      { name: 'orders', names: [], file: 'charts/orders/templates/service.yaml', ports: [{ published: 30080, container: 3000, file: 'charts/orders/templates/service.yaml', line: 8 }], environment: {}, via: 'node-port' },
    ]);
    expect(read['orders']?.hosts.map((alias) => alias.host)).toContain('localhost:30080');
  });

  it('says where a condition nothing decides gives the ports two ways, and reads the literal lines', () => {
    const dir = project({
      'orders/chart/Chart.yaml': 'apiVersion: v2\nname: orders\n',
      'orders/chart/templates/service.yaml': lines(
        'apiVersion: v1',
        'kind: Service',
        'metadata:',
        '  name: orders',
        'spec:',
        '  ports:',
        '    - port: 80',
        '      {{- if .Capabilities.APIVersions.Has "v2" }}',
        '      targetPort: 3000',
        '      {{- else }}',
        '      targetPort: 4000',
        '      {{- end }}',
      ),
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.rows?.map((row) => `${row.reason} ${row.file}:${row.line}`)).toEqual(['manifest-unread chart/templates/service.yaml:8']);
  });

  it('chooses among installs by the environment, and says where nothing chooses', () => {
    const files = {
      'orders/chart/Chart.yaml': 'apiVersion: v2\nname: orders\n',
      'orders/chart/values-staging.yaml': 'port: 81\n',
      'orders/chart/values-production.yaml': 'port: 82\n',
      'orders/chart/templates/service.yaml': lines('apiVersion: v1', 'kind: Service', 'metadata:', '  name: orders', 'spec:', '  ports:', '    - port: {{ .Values.port }}', '      targetPort: 3000'),
      'orders/deploy.sh': lines('helm install orders ./chart -f chart/values-staging.yaml', 'helm install orders ./chart -f chart/values-production.yaml'),
    };
    const ports = (environment?: string) => {
      const dir = project(files);
      const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir, ...(environment === undefined ? {} : { environment }) });
      const out = { ports: read['orders']?.routes?.flatMap((each) => each.ports.map((port) => port.port)) ?? [], rows: read['orders']?.rows?.map((row) => row.reason) ?? [] };
      rmSync(dir, { recursive: true, force: true });
      root = undefined;
      return out;
    };
    expect(ports('prod')).toEqual({ ports: [82], rows: [] });
    expect(ports()).toEqual({ ports: [], rows: ['manifest-overlay-unchosen'] });
  });

  it('builds a kustomization over its base, with its patches, images, namespace and prefix', () => {
    const dir = project({
      'deploy/base/kustomization.yaml': 'resources:\n  - orders.yaml\n',
      'deploy/base/orders.yaml': `${DEPLOYMENT('orders', 3000)}\n---\n${SERVICE('orders', 80, 'http')}\n`,
      'deploy/overlays/prod/kustomization.yaml': lines(
        'namespace: shop',
        'namePrefix: prod-',
        'resources:',
        '  - ../../base',
        'images:',
        '  - name: registry.example.test/orders',
        '    newName: registry.example.test/orders-api',
        'patches:',
        '  - path: port.yaml',
        '  - target:',
        '      kind: Service',
        '      name: orders',
        '    patch: |-',
        '      - op: replace',
        '        path: /spec/ports/0/port',
        '        value: 8080',
        'patchesStrategicMerge:',
        '  - env.yaml',
      ),
      'deploy/overlays/prod/port.yaml': lines('apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: orders', 'spec:', '  template:', '    spec:', '      containers:', '        - name: orders', '          ports:', '            - containerPort: 3000', '              name: web'),
      'deploy/overlays/prod/env.yaml': lines('apiVersion: apps/v1', 'kind: Deployment', 'metadata:', '  name: orders', 'spec:', '  template:', '    spec:', '      containers:', '        - name: orders', '          env:', '            - name: PORT', '              value: "3000"'),
    });
    const read = readManifestsUnder(dir);
    expect(read.services).toEqual([
      { name: 'prod-orders', namespace: 'shop', selector: { app: 'orders' }, ports: [{ port: 8080, target: 'http', file: 'deploy/base/orders.yaml', line: 26 }], file: 'deploy/base/orders.yaml' },
    ]);
    expect(read.workloads.map((each) => ({ name: each.name, namespace: each.namespace, containers: each.containers }))).toEqual([
      { name: 'prod-orders', namespace: 'shop', containers: [{ name: 'orders', image: 'orders-api', ports: [{ port: 3000, name: 'web' }], environment: [{ name: 'PORT', raw: '3000' }], environmentFile: 'deploy/overlays/prod/env.yaml' }] },
    ]);
    expect(read.rows).toBeUndefined();
  });

  it('reads the overlay the environment names, and the base alone where overlays nothing chooses differ', () => {
    const files = {
      'k8s/base/kustomization.yaml': 'resources:\n  - service.yaml\n',
      'k8s/base/service.yaml': SERVICE('orders', 80, 3000),
      'k8s/overlays/staging/kustomization.yaml': 'resources:\n  - ../../base\npatches:\n  - target:\n      kind: Service\n    patch: |-\n      - op: replace\n        path: /spec/ports/0/port\n        value: 81\n',
      'k8s/overlays/production/kustomization.yaml': 'resources:\n  - ../../base\npatches:\n  - target:\n      kind: Service\n    patch: |-\n      - op: replace\n        path: /spec/ports/0/port\n        value: 82\n',
    };
    const dir = project(files);
    const chosen = readManifestsUnder(dir, new Set(), { environment: 'production', environmentOf: (word) => (word === 'prod' ? 'production' : word) });
    expect(chosen.services.map((each) => each.ports.map((port) => port.port))).toEqual([[82]]);
    const named = readManifestsUnder(dir, new Set(), { overlays: [join(dir, 'k8s/overlays/staging')] });
    expect(named.services.map((each) => each.ports.map((port) => port.port))).toEqual([[81]]);
    const unchosen = readManifestsUnder(dir);
    expect(unchosen.services.map((each) => each.ports.map((port) => port.port))).toEqual([[80]]);
    expect(unchosen.rows?.map((row) => `${row.reason} ${row.file}`)).toEqual(['manifest-overlay-unchosen k8s/overlays/production/kustomization.yaml']);
  });

  it('says where a patch is not applied as written', () => {
    const dir = project({
      'k8s/kustomization.yaml': 'resources:\n  - service.yaml\npatches:\n  - target:\n      kind: Service\n      name: orders\n    patch: |-\n      - op: move\n        from: /spec/ports/0\n        path: /spec/ports/1\n',
      'k8s/service.yaml': SERVICE('orders', 80, 3000),
    });
    expect(readManifestsUnder(dir).rows?.map((row) => `${row.reason}: ${row.message}`)).toEqual(['manifest-unread: k8s/kustomization.yaml does not patch orders as written: its move operation is not applied']);
  });

  it('reads the ways in an Ingress and an HTTPRoute write, rewrites included', () => {
    const dir = project({
      'k8s/ingress.yaml': lines(
        'apiVersion: networking.k8s.io/v1',
        'kind: Ingress',
        'metadata:',
        '  name: shop',
        '  annotations:',
        '    nginx.ingress.kubernetes.io/rewrite-target: /$2',
        'spec:',
        '  rules:',
        '    - host: shop.example.test',
        '      http:',
        '        paths:',
        '          - path: /api(/|$)(.*)',
        '            pathType: ImplementationSpecific',
        '            backend:',
        '              service:',
        '                name: orders',
        '                port:',
        '                  name: web',
      ),
      'k8s/route.yaml': lines(
        'apiVersion: gateway.networking.k8s.io/v1',
        'kind: Gateway',
        'metadata:',
        '  name: edge',
        'spec:',
        '  listeners:',
        '    - name: http',
        '      hostname: "*.example.test"',
        '---',
        'apiVersion: gateway.networking.k8s.io/v1',
        'kind: HTTPRoute',
        'metadata:',
        '  name: stock',
        'spec:',
        '  parentRefs:',
        '    - name: edge',
        '  rules:',
        '    - matches:',
        '        - path:',
        '            type: PathPrefix',
        '            value: /stock',
        '      filters:',
        '        - type: URLRewrite',
        '          urlRewrite:',
        '            path:',
        '              type: ReplacePrefixMatch',
        '              replacePrefixMatch: /v1/stock',
        '      backendRefs:',
        '        - name: stock',
        '          port: 8080',
      ),
    });
    expect(readManifestsUnder(dir).ingresses).toEqual([
      {
        kind: 'ingress',
        name: 'shop',
        hosts: ['shop.example.test'],
        paths: [{ match: 'pattern', path: '^/api(/|$)(.*)', flags: 'i', backends: [{ name: 'orders', port: 'web' }], rewrite: { kind: 'pattern', source: '^/api(/|$)(.*)', flags: 'i', with: '/$2' }, hosts: ['shop.example.test'], file: 'k8s/ingress.yaml', line: 12 }],
        file: 'k8s/ingress.yaml',
      },
      {
        kind: 'http-route',
        name: 'stock',
        hosts: ['*.example.test'],
        paths: [{ match: 'prefix', path: '/stock', backends: [{ name: 'stock', port: 8080 }], rewrite: { kind: 'prefix', with: '/v1/stock' }, file: 'k8s/route.yaml', line: 19 }],
        file: 'k8s/route.yaml',
      },
    ]);
  });
});

describe('what a project’s cluster files say about how its services are reached (P260)', () => {
  it('hands each way in, port-forward and node port to the service behind the object it names', () => {
    const dir = project({
      'orders/k8s/orders.yaml': `${DEPLOYMENT('orders', 3000)}\n---\n${lines('apiVersion: v1', 'kind: Service', 'metadata:', '  name: orders', 'spec:', '  selector:', '    app: orders', '  ports:', '    - name: web', '      port: 80', '      targetPort: http')}\n`,
      'stock/k8s/stock.yaml': `${DEPLOYMENT('stock', 4000)}\n---\n${SERVICE('stock', 8080, 4000, ['  type: NodePort'])}\n`,
      'deploy/ingress.yaml': lines(
        'apiVersion: networking.k8s.io/v1',
        'kind: Ingress',
        'metadata:',
        '  name: shop',
        'spec:',
        '  rules:',
        '    - host: shop.example.test',
        '      http:',
        '        paths:',
        '          - path: /orders',
        '            pathType: Prefix',
        '            backend:',
        '              service:',
        '                name: orders',
        '                port:',
        '                  name: web',
        '          - path: /health',
        '            pathType: Exact',
        '            backend:',
        '              service:',
        '                name: stock',
        '                port:',
        '                  number: 8080',
      ),
      'Makefile': 'forward:\n\tkubectl port-forward svc/orders 8081:80\n\tkubectl port-forward deploy/stock 4001:4000\n',
    });
    const read = readProjectSettings({ services: ['orders', 'stock'].map((name) => ({ name, dir: join(dir, name) })), rootDir: dir });
    expect(read['orders']?.ingress).toEqual([
      { host: 'shop.example.test', object: 'ingress/shop', rule: { path: '/orders', target: `http:${'/'.repeat(2)}orders`, to: '/orders', file: 'deploy/ingress.yaml', line: 10 } },
    ]);
    expect(read['stock']?.ingress?.map((each) => each.rule)).toEqual([{ path: '/health', target: `http:${'/'.repeat(2)}stock:8080`, to: '/health', file: 'deploy/ingress.yaml', line: 17, exact: true }]);
    expect(read['orders']?.containers).toEqual([
      { name: 'svc/orders', names: [], file: 'Makefile', ports: [{ published: 8081, container: 3000, file: 'Makefile', line: 2 }], environment: {}, via: 'forwarded', environmentFrom: 'k8s/orders.yaml' },
    ]);
    expect(read['stock']?.containers?.map((each) => `${each.via} ${each.name} ${each.ports.map((port) => `${port.published}:${port.container}`).join(',')}`)).toEqual(['forwarded deploy/stock 4001:4000']);
  });
});

describe('every way a cluster is installed (P263)', () => {
  const ordersChart = {
    'orders/charts/orders/Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n',
    'orders/charts/orders/values.yaml': 'service:\n  port: 80\n',
    'orders/charts/orders/templates/service.yaml': SERVICE('orders', 0, 3000).replace('port: 0', 'port: {{ .Values.service.port }}'),
    'orders/charts/orders/templates/deployment.yaml': DEPLOYMENT('orders', 3000),
  };

  it("reads a helmfile's releases in each environment it declares, its values rendered over the environment", () => {
    const dir = project({
      ...ordersChart,
      'orders/helmfile.yaml': lines(
        'environments:',
        '  staging:',
        '    values:',
        '      - env/staging.yaml',
        '  production:',
        '    values:',
        '      - replicas: 3',
        '---',
        'releases:',
        '  - name: orders',
        '    namespace: shop',
        '    chart: ./charts/orders',
        '    values:',
        '      - values/orders-{{ .Environment.Name }}.yaml',
        '      - service:',
        '          type: ClusterIP',
        '    set:',
        '      - name: replicas',
        '        value: {{ .Values.replicas | default 1 }}',
        '  - name: cache',
        '    chart: bitnami/redis',
        '  - name: off',
        '    chart: ./charts/orders',
        '    installed: false',
      ),
      'orders/env/staging.yaml': 'replicas: 1\n',
      'orders/values/orders-staging.yaml': 'service:\n  port: 8081\n',
      'orders/values/orders-production.yaml': 'service:\n  port: 8080\n',
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir, environment: 'production' });
    expect(read['orders']?.routes?.map((each) => each.ports.map((port) => `${port.port}:${port.target}`).join(','))).toEqual(['8080:3000']);
    // With nothing choosing, the two environments disagree, and the chart's own values are read.
    const unchosen = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(unchosen['orders']?.routes?.map((each) => each.ports.map((port) => `${port.port}:${port.target}`).join(','))).toEqual(['80:3000']);
    expect(unchosen['orders']?.rows?.map((row) => `${row.reason} ${row.file}`)).toEqual(['manifest-overlay-unchosen charts/orders/Chart.yaml']);
    expect(unchosen['orders']?.rows?.[0]?.message).toContain('helmfile.yaml:10 (environment production)');
  });

  it('reads the environment a pipeline runs helmfile with, and a port-forward and a chart install a GitLab job writes', () => {
    const dir = project({
      ...ordersChart,
      'orders/helmfile.yaml': lines('environments:', '  staging: {}', '  production: {}', '---', 'releases:', '  - name: orders', '    chart: ./charts/orders', '    values:', '      - values/{{ .Environment.Name }}.yaml'),
      'orders/values/staging.yaml': 'service:\n  port: 8081\n',
      'orders/values/production.yaml': 'service:\n  port: 8080\n',
      'orders/.github/workflows/deploy.yml': lines('jobs:', '  deploy:', '    runs-on: ubuntu-latest', '    steps:', '      - run: helmfile -e production apply'),
      'orders/.gitlab-ci.yml': lines('forward:', '  script:', '    - kubectl port-forward svc/orders 8082:8080'),
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.routes?.map((each) => each.ports.map((port) => `${port.port}:${port.target}`).join(','))).toEqual(['8080:3000']);
    expect(read['orders']?.containers?.filter((each) => each.via === 'forwarded').map((each) => `${each.file} ${each.ports.map((port) => `${port.published}:${port.container}`).join(',')}`)).toEqual(['.gitlab-ci.yml 8082:3000']);
  });

  it("renders a chart's dependencies inside its release, with its values' subtree, and leaves out one its condition turns off", () => {
    const dir = project({
      'shop/charts/shop/Chart.yaml': lines('apiVersion: v2', 'name: shop', 'version: 1.0.0', 'dependencies:', '  - name: common', '    repository: file://../common', '  - name: metrics', '    condition: metrics.enabled', '  - name: catalog', '    alias: products'),
      'shop/charts/shop/values.yaml': 'metrics:\n  enabled: false\nproducts:\n  port: 8083\nglobal:\n  zone: eu\n',
      'shop/charts/shop/templates/service.yaml': SERVICE('x', 80, 3000).replace('name: x', 'name: {{ include "common.name" . }}').replace('app: x', 'app: shop'),
      'shop/charts/common/Chart.yaml': 'apiVersion: v2\nname: common\ntype: library\nversion: 1.0.0\n',
      'shop/charts/common/templates/_names.tpl': '{{- define "common.name" -}}\n{{ .Release.Name }}-{{ .Chart.Name }}\n{{- end }}\n',
      'shop/charts/shop/charts/metrics/Chart.yaml': 'apiVersion: v2\nname: metrics\nversion: 1.0.0\n',
      'shop/charts/shop/charts/metrics/templates/service.yaml': SERVICE('metrics', 9100, 9100),
      'shop/charts/shop/charts/catalog/Chart.yaml': 'apiVersion: v2\nname: catalog\nversion: 1.0.0\n',
      'shop/charts/shop/charts/catalog/values.yaml': 'port: 80\n',
      'shop/charts/shop/charts/catalog/templates/service.yaml': SERVICE('catalog', 0, 3003).replace('port: 0', 'port: {{ .Values.port }}').replace('name: catalog', 'name: {{ include "common.name" . }}-{{ .Values.global.zone }}'),
    });
    const read = readManifestsUnder(dir);
    expect(read.services.map((each) => `${each.name} ${each.ports.map((port) => port.port).join(',')} ${each.file}`)).toEqual([
      'shop-shop 80 shop/charts/shop/templates/service.yaml',
      'shop-catalog-eu 8083 shop/charts/shop/charts/catalog/templates/service.yaml',
    ]);
  });

  it("inflates a kustomization's charts, generates its config maps into the pods' environment, and applies its replacements", () => {
    const dir = project({
      'stock/k8s/kustomization.yaml': lines(
        'resources:',
        '  - stock.yaml',
        'configMapGenerator:',
        '  - name: stock-config',
        '    literals:',
        '      - PORT=4100',
        '    envs:',
        '      - stock.env',
        'helmCharts:',
        '  - name: stock-api',
        '    releaseName: stock-api',
        '    valuesInline:',
        '      port: 9090',
        '  - name: redis',
        '    repo: https://charts.example.test',
        'replacements:',
        '  - source:',
        '      kind: ConfigMap',
        '      name: stock-config',
        '      fieldPath: data.PORT',
        '    targets:',
        '      - select:',
        '          kind: Service',
        '          name: stock',
        '        fieldPaths:',
        '          - spec.ports.0.targetPort',
        '  - source:',
        '      kind: ConfigMap',
        '      name: missing',
        '    targets: []',
        'vars:',
        '  - name: X',
      ),
      'stock/k8s/stock.env': 'METRICS_PORT=9464\n',
      'stock/k8s/stock.yaml': `${DEPLOYMENT('stock', 4100, ['          envFrom:', '            - configMapRef:', '                name: stock-config'])}\n---\n${SERVICE('stock', 80, 3000)}\n`,
      'stock/k8s/charts/stock-api/Chart.yaml': 'apiVersion: v2\nname: stock-api\nversion: 1.0.0\n',
      'stock/k8s/charts/stock-api/values.yaml': 'port: 80\n',
      'stock/k8s/charts/stock-api/templates/service.yaml': SERVICE('stock-api', 0, 4200).replace('port: 0', 'port: {{ .Values.port }}'),
    });
    const read = readManifestsUnder(join(dir, 'stock'));
    expect(read.services.map((each) => `${each.name} ${each.ports.map((port) => `${port.port}:${port.target}`).join(',')}`)).toEqual(['stock 80:4100', 'stock-api 9090:4200']);
    expect(read.workloads[0]?.containers[0]?.environment).toEqual([
      { name: 'PORT', raw: '4100' },
      { name: 'METRICS_PORT', raw: '9464' },
    ]);
    expect(read.workloads[0]?.containers[0]?.environmentFile).toBe('k8s/kustomization.yaml');
    expect(read.rows?.map((row) => `${row.reason} ${row.file}:${row.line}`)).toEqual(['manifest-unread k8s/kustomization.yaml:9', 'manifest-unread k8s/kustomization.yaml:16', 'manifest-unread k8s/kustomization.yaml:31']);
  });

  it('reads a value a pod takes from a config map or a secret by key', () => {
    const dir = project({
      'k8s/orders.yaml': lines(
        DEPLOYMENT('orders', 3000, ['          env:', '            - name: PORT', '              valueFrom:', '                configMapKeyRef:', '                  name: orders', '                  key: port', '            - name: ADMIN_PORT', '              valueFrom:', '                secretKeyRef:', '                  name: orders', '                  key: admin']),
        '---',
        'apiVersion: v1',
        'kind: ConfigMap',
        'metadata:',
        '  name: orders',
        'data:',
        '  port: "3000"',
        '---',
        'apiVersion: v1',
        'kind: Secret',
        'metadata:',
        '  name: orders',
        'data:',
        `  admin: ${Buffer.from('3001').toString('base64')}`,
      ),
    });
    expect(readManifestsUnder(dir).workloads[0]?.containers[0]?.environment).toEqual([
      { name: 'PORT', raw: '3000' },
      { name: 'ADMIN_PORT', raw: '3001' },
    ]);
  });

  it('reads a rule with no host as a way in at any host, each path at its own rule\'s host', () => {
    const dir = project({
      'k8s/ingress.yaml': lines(
        'apiVersion: networking.k8s.io/v1',
        'kind: Ingress',
        'metadata:',
        '  name: shop',
        'spec:',
        '  rules:',
        '    - host: shop.example.test',
        '      http:',
        '        paths:',
        '          - path: /orders',
        '            pathType: Prefix',
        '            backend:',
        '              service: { name: orders, port: { number: 80 } }',
        '    - http:',
        '        paths:',
        '          - path: /',
        '            pathType: Prefix',
        '            backend:',
        '              service: { name: web, port: { number: 80 } }',
      ),
    });
    const [ingress] = readManifestsUnder(dir).ingresses ?? [];
    expect(ingress?.hosts).toEqual(['shop.example.test', '*']);
    expect(ingress?.paths.map((path) => `${path.path} ${path.hosts?.join(',')}`)).toEqual(['/orders shop.example.test', '/ *']);
  });

  it('chooses the overlay a pipeline applies among those nothing else chooses', () => {
    const overlay = (port: number) => lines('resources:', '  - ../../base', 'patches:', '  - target:', '      kind: Service', '      name: stock', '    patch: |-', '      - op: replace', '        path: /spec/ports/0/port', `        value: ${port}`);
    const dir = project({
      'stock/deploy/base/kustomization.yaml': 'resources:\n  - stock.yaml\n',
      'stock/deploy/base/stock.yaml': `${DEPLOYMENT('stock', 4000)}\n---\n${SERVICE('stock', 80, 4000)}\n`,
      'stock/deploy/overlays/blue/kustomization.yaml': overlay(8081),
      'stock/deploy/overlays/green/kustomization.yaml': overlay(8082),
      '.gitlab-ci.yml': lines('deploy:', '  script:', '    - cd stock && kubectl apply -k deploy/overlays/green'),
    });
    const read = readProjectSettings({ services: [{ name: 'stock', dir: join(dir, 'stock') }], rootDir: dir });
    expect(read['stock']?.routes?.map((each) => each.ports.map((port) => port.port).join(','))).toEqual(['8082']);
    expect(read['stock']?.rows ?? []).toEqual([]);
  });
});

describe('helmfile bases and needs, and kustomize vars (P273)', () => {
  const chart = (name: string, port: number): Record<string, string> => ({
    [`deploy/charts/${name}/Chart.yaml`]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
    [`deploy/charts/${name}/values.yaml`]: 'port: 80\n',
    [`deploy/charts/${name}/templates/service.yaml`]: SERVICE(name, 0, port).replace('port: 0', 'port: {{ .Values.port }}').replace(`name: ${name}`, 'name: {{ .Release.Name }}'),
  });
  const layered = (): string =>
    project({
      ...chart('orders', 3000),
      ...chart('db', 5432),
      'deploy/helmfile.yaml': lines(
        'bases:',
        '  - bases/environments.yaml',
        '  - bases/releases.yaml.gotmpl',
        '---',
        'releases:',
        '  - name: orders',
        '    chart: ./charts/orders',
        '    needs:',
        '      - shop/db',
        '      - cache',
        '    values:',
        '      - port: {{ .Values.ordersPort }}',
      ),
      'deploy/bases/environments.yaml': lines('environments:', '  staging:', '    values:', '      - ordersPort: 8081', '  production:', '    values:', '      - values/production.yaml'),
      'deploy/values/production.yaml': 'ordersPort: 8080\ndbPort: 5433\n',
      'deploy/bases/releases.yaml.gotmpl': lines(
        'releases:',
        '  - name: db',
        '    namespace: shop',
        '    chart: ./charts/db',
        '    needs:',
        '      - config',
        '    values:',
        '      - port: {{ .Values.dbPort | default 5432 }}',
        '  - name: config',
        '    chart: ./charts/db',
      ),
    });

  const said = (installs: readonly ChartInstall[]): string[] =>
    installs.map((each) => `${each.environment} ${each.release} ${each.file}:${each.line} ${JSON.stringify(each.values)}${each.needs === undefined ? '' : ` after ${each.needs.join(',')}`}`);

  it("layers a helmfile's bases under it, their environments, values and releases first, and keeps what each release needs", () => {
    const dir = layered();
    // Named as the build names them: relative, with the separators every platform shares.
    const read = readHelmfile(join(dir, 'deploy/helmfile.yaml'), (path) => relative(join(dir, 'deploy'), path).split(sep).join(posix.sep));
    expect(said(read.installs)).toEqual([
      'production db bases/releases.yaml.gotmpl:2 [{"port":5433}] after config',
      'production config bases/releases.yaml.gotmpl:9 []',
      'production orders helmfile.yaml:6 [{"port":8080}] after db',
      'staging db bases/releases.yaml.gotmpl:2 [{"port":5432}] after config',
      'staging config bases/releases.yaml.gotmpl:9 []',
      'staging orders helmfile.yaml:6 [{"port":8081}] after db',
    ]);
    expect(read.rows.map((row) => `${row.reason} ${row.file}:${row.line} ${row.message}`)).toEqual([
      'release-need-undefined helmfile.yaml:6 The release orders (helmfile.yaml:6) needs cache, which no release of the helmfile is; helmfile refuses to apply it',
    ]);
  });

  it('keeps what the releases a command keeps need, with --include-needs and --include-transitive-needs', () => {
    const dir = layered();
    const kept = (needs: 'none' | 'direct' | 'transitive'): string[] =>
      readHelmfile(join(dir, 'deploy/helmfile.yaml'), (path) => relative(join(dir, 'deploy'), path).split(sep).join(posix.sep), { environments: ['production'], releases: ['orders'], needs }).installs.map((each) => each.release ?? '');
    expect(kept('none')).toEqual(['orders']);
    expect(kept('direct')).toEqual(['db', 'orders']);
    expect(kept('transitive')).toEqual(['db', 'config', 'orders']);
  });

  it('reads a folder of helmfiles a command names with -f, and the needs it includes', () => {
    const dir = project({
      ...chart('orders', 3000),
      ...chart('db', 5432),
      'deploy/helmfile.d/10-shop.yaml': lines('environments:', '  production: {}', '---', 'releases:', '  - name: orders', '    chart: ../charts/orders', '    needs: [db]', '    values:', '      - port: 8080', '  - name: db', '    chart: ../charts/db', '    values:', '      - port: 5433'),
      Makefile: lines('deploy:', '\thelmfile -f deploy/helmfile.d -e production -l name=orders --include-needs apply'),
    });
    const read = readProjectSettings({ services: [{ name: 'orders', dir: join(dir, 'orders') }], rootDir: dir });
    expect(read['orders']?.routes?.map((each) => `${each.name} ${each.ports.map((port) => `${port.port}:${port.target}`).join(',')}`)).toEqual(['orders 8080:3000']);
  });

  it("substitutes a kustomization's vars, its bases' too, once the build is named and prefixed, and says one it cannot", () => {
    const dir = project({
      'web/k8s/base/kustomization.yaml': lines(
        'resources:',
        '  - web.yaml',
        'vars:',
        '  - name: ORDERS_SERVICE',
        '    objref: { kind: Service, name: orders, apiVersion: v1 }',
        '  - name: ORDERS_PORT',
        '    objref: { kind: Service, name: orders, apiVersion: v1 }',
        '    fieldref: { fieldpath: "spec.ports[0].port" }',
        '  - name: WEB_PORT',
        '    objref: { kind: ConfigMap, name: web, apiVersion: v1 }',
        '    fieldref: { fieldpath: data.port }',
        '  - name: GONE',
        '    objref: { kind: Service, name: gone, apiVersion: v1 }',
      ),
      'web/k8s/base/web.yaml': [
        DEPLOYMENT('web', 4000, ['          args: ["--port=$(WEB_PORT)", "--home=$(HOME)"]', '          env:', '            - name: ORDERS_URL', '              value: http://$(ORDERS_SERVICE):$(ORDERS_PORT)', '            - name: PORT', '              value: $(WEB_PORT)', '            - name: GONE_URL', '              value: http://$(GONE)']),
        SERVICE('orders', 8080, 3000),
        lines('apiVersion: v1', 'kind: ConfigMap', 'metadata:', '  name: web', 'data:', '  port: "4000"', '  host: shop-$(ORDERS_SERVICE).example.test'),
        lines('apiVersion: networking.k8s.io/v1', 'kind: Ingress', 'metadata:', '  name: edge', 'spec:', '  rules:', '    - host: $(ORDERS_SERVICE).example.test', '      http:', '        paths:', '          - path: /', '            pathType: Prefix', '            backend:', '              service:', '                name: orders', '                port:', '                  number: 8080'),
      ].join('\n---\n'),
      'web/k8s/overlays/production/kustomization.yaml': lines('resources:', '  - ../../base', 'namePrefix: shop-'),
    });
    const read = readManifestsUnder(join(dir, 'web'));
    const container = read.workloads[0]?.containers[0];
    expect(container?.environment).toEqual([
      { name: 'ORDERS_URL', raw: 'http://shop-orders:8080' },
      { name: 'PORT', raw: '4000' },
      { name: 'GONE_URL', raw: 'http://$(GONE)' },
    ]);
    expect(read.ingresses?.map((each) => each.hosts.join(','))).toEqual(['shop-orders.example.test']);
    expect(read.rows?.map((row) => `${row.reason} ${row.file}:${row.line} ${row.message}`)).toEqual([
      'manifest-unread k8s/base/kustomization.yaml:3 k8s/base/kustomization.yaml declares the var GONE, which is not substituted: Service/gone is not built',
    ]);
  });
});

/** A packed chart as helm packs one (P289): a gzipped tar of the chart's folder, each file under `<name>/`. */
const packed = (files: Record<string, string>): Buffer => {
  const blocks: Buffer[] = [];
  for (const [name, text] of Object.entries(files)) {
    const body = Buffer.from(text, 'utf8');
    const header = Buffer.alloc(512, 0);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.write('0', 156, 1, 'ascii');
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.fill(' ', 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
};

describe('sub-helmfiles, release templates, packed charts and kustomize configurations (P289)', () => {
  const chart = (name: string, port: number): Record<string, string> => ({
    [`deploy/charts/${name}/Chart.yaml`]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
    [`deploy/charts/${name}/values.yaml`]: 'port: 80\n',
    [`deploy/charts/${name}/templates/service.yaml`]: SERVICE(name, 0, port).replace('port: 0', 'port: {{ .Values.port }}').replace(`name: ${name}`, 'name: {{ .Release.Name }}'),
  });
  const label = (dir: string) => (path: string): string => relative(join(dir, 'deploy'), path).split(sep).join(posix.sep);
  const said = (installs: readonly ChartInstall[]): string[] =>
    installs.map((each) => `${each.environment} ${each.release}${each.namespace === undefined ? '' : `@${each.namespace}`} ${each.file}:${each.line} ${JSON.stringify(each.values)}`);

  it('reads sub-helmfiles in the environment of the helmfile naming them, with the values and selectors each entry gives', () => {
    const dir = project({
      ...chart('orders', 3000),
      ...chart('stock', 3100),
      'deploy/helmfile.yaml': lines(
        'environments:',
        '  production:',
        '    values:',
        '      - region: eu',
        '---',
        'helmfiles:',
        '  - path: apps/*/helmfile.yaml',
        '    values:',
        '      - port: 8443',
        '  - path: apps/stock/helmfile.yaml',
        '    selectors:',
        '      - tier=backend',
        '  - path: git::https://example.test/infra.git@helmfile.yaml',
        '  - apps/missing.yaml',
      ),
      'deploy/apps/orders/helmfile.yaml': lines(
        'environments:',
        '  production: {}',
        '---',
        'releases:',
        '  - name: orders',
        '    chart: ../../charts/orders',
        '    values:',
        '      - port: {{ .Values.port | default 80 }}',
      ),
      'deploy/apps/stock/helmfile.yaml': lines(
        'environments:',
        '  production: {}',
        '---',
        'releases:',
        '  - name: stock',
        '    chart: ../../charts/stock',
        '    labels: { tier: backend }',
        '  - name: stock-admin',
        '    chart: ../../charts/stock',
        '    labels: { tier: admin }',
      ),
    });
    const read = readHelmfile(join(dir, 'deploy/helmfile.yaml'), label(dir));
    expect(said(read.installs)).toEqual([
      'production orders apps/orders/helmfile.yaml:5 [{"port":8443}]',
      'production stock apps/stock/helmfile.yaml:5 []',
      'production stock-admin apps/stock/helmfile.yaml:8 []',
      'production stock apps/stock/helmfile.yaml:5 []',
    ]);
    expect(read.rows.map((row) => `${row.file}:${row.line} ${row.message}`)).toEqual([
      'helmfile.yaml:13 helmfile.yaml is not read from line 13: the sub-helmfile git::https://example.test/infra.git@helmfile.yaml is fetched from outside the project when helmfile runs, and nothing remote is fetched here',
      'helmfile.yaml:14 helmfile.yaml is not read from line 14: the sub-helmfile apps/missing.yaml is not in the project',
    ]);
    // A command's selectors reach a sub-helmfile that writes none of its own; one that writes its own is read with those.
    const kept = readHelmfile(join(dir, 'deploy/helmfile.yaml'), label(dir), { environments: ['production'], selectors: ['tier=admin'] });
    expect(said(kept.installs)).toEqual(['production stock-admin apps/stock/helmfile.yaml:8 []', 'production stock apps/stock/helmfile.yaml:5 []']);
  });

  it('gives a release the release templates it inherits and the mapping a merge key names, its fields rendered with the release', () => {
    const dir = project({
      ...chart('orders', 3000),
      ...chart('stock', 3100),
      'deploy/values/orders.yaml': 'port: 8081\n',
      'deploy/values/stock.yaml': 'port: 8082\n',
      'deploy/helmfile.yaml': lines(
        'helmDefaults:',
        '  wait: true',
        'templates:',
        '  default: &default',
        '    namespace: shop',
        '    values:',
        '      - values/{{`{{ .Release.Name }}`}}.yaml',
        '  backend:',
        '    chart: ./charts/{{`{{ .Release.Name }}`}}',
        '    namespace: backend',
        'releases:',
        '  - name: orders',
        '    <<: *default',
        '    chart: ./charts/orders',
        '  - name: stock',
        '    inherit:',
        '      - template: default',
        '      - template: backend',
        '        except: [namespace]',
        '  - name: gone',
        '    inherit: [{ template: missing }]',
        '    chart: ./charts/orders',
      ),
    });
    const read = readHelmfile(join(dir, 'deploy/helmfile.yaml'), label(dir));
    expect(read.installs.map((each) => `${each.release}@${each.namespace} ${each.chart.slice(dir.length).split(sep).join(posix.sep)} ${each.values.map((value) => (typeof value === 'string' ? value.slice(dir.length).split(sep).join(posix.sep) : JSON.stringify(value))).join(',')}`)).toEqual([
      'orders@shop /deploy/charts/orders /deploy/values/orders.yaml',
      'stock@shop /deploy/charts/stock /deploy/values/stock.yaml',
      'gone@undefined /deploy/charts/orders ',
    ]);
    expect(read.rows.map((row) => `${row.file}:${row.line} ${row.message}`)).toEqual([
      'helmfile.yaml:20 helmfile.yaml is not read from line 20: the release gone inherits the template missing, which no part of the helmfile declares',
    ]);
  });

  it("renders a packed dependency in its parent's release, and the values it hands its parent through import-values", () => {
    const dir = project({
      'deploy/charts/shop/Chart.yaml': lines(
        'apiVersion: v2',
        'name: shop',
        'version: 0.1.0',
        'dependencies:',
        '  - name: cache',
        '    version: 1.2.3',
        '    repository: https://charts.example.test',
        '    import-values:',
        '      - ports',
        '      - child: service',
        '        parent: cacheService',
      ),
      'deploy/charts/shop/values.yaml': 'cache:\n  service:\n    port: 6380\n',
      'deploy/charts/shop/templates/web.yaml': SERVICE('web', 0, 3000).replace('port: 0', 'port: {{ .Values.webPort }}').replace('  selector:', '  annotations:\n    cache-port: "{{ .Values.cacheService.port }}"\n  selector:'),
    });
    mkdirSync(join(dir, 'deploy/charts/shop/charts'));
    writeFileSync(
      join(dir, 'deploy/charts/shop/charts/cache-1.2.3.tgz'),
      packed({
        'cache/Chart.yaml': 'apiVersion: v2\nname: cache\nversion: 1.2.3\n',
        'cache/values.yaml': 'service:\n  port: 6379\nexports:\n  ports:\n    webPort: 8080\n',
        'cache/templates/service.yaml': SERVICE('cache', 0, 6379).replace('port: 0', 'port: {{ .Values.service.port }}').replace('name: cache', 'name: {{ .Release.Name }}-cache'),
      }),
    );
    const read = readManifestsUnder(join(dir, 'deploy'));
    expect(read.services.map((each) => `${each.name} ${each.ports.map((port) => `${port.port}:${port.target}`).join(',')} ${each.file}`)).toEqual([
      'web 8080:3000 charts/shop/templates/web.yaml',
      'shop-cache 6380:6379 charts/shop/charts/cache-1.2.3.tgz/cache/templates/service.yaml',
    ]);
  });

  it("renames the fields a kustomization's configurations say name a resource, substitutes vars in the fields they add, and generates a key per file", () => {
    const dir = project({
      'web/k8s/base/kustomization.yaml': lines(
        'resources:',
        '  - web.yaml',
        'configurations:',
        '  - kustomizeconfig.yaml',
        'configMapGenerator:',
        '  - name: web',
        '    files:',
        '      - settings.json',
        '      - upstream=upstream.txt',
        'vars:',
        '  - name: ORDERS_SERVICE',
        '    objref: { kind: Service, name: orders, apiVersion: v1 }',
      ),
      'web/k8s/base/kustomizeconfig.yaml': lines(
        'nameReference:',
        '  - kind: Service',
        '    fieldSpecs:',
        '      - kind: HTTPRoute',
        '        path: spec/rules/backendRefs/name',
        'varReference:',
        '  - kind: HTTPRoute',
        '    path: spec/hostnames',
      ),
      'web/k8s/base/settings.json': '{"cache":"redis"}',
      'web/k8s/base/upstream.txt': 'http://orders:8080',
      'web/k8s/base/web.yaml': [
        DEPLOYMENT('web', 4000, ['          env:', '            - name: UPSTREAM', '              valueFrom:', '                configMapKeyRef:', '                  name: web', '                  key: upstream']),
        SERVICE('orders', 8080, 3000),
        lines(
          'apiVersion: gateway.networking.k8s.io/v1',
          'kind: HTTPRoute',
          'metadata:',
          '  name: edge',
          'spec:',
          '  hostnames:',
          '    - $(ORDERS_SERVICE).example.test',
          '  rules:',
          '    - matches:',
          '        - path: { type: PathPrefix, value: /orders }',
          '      backendRefs:',
          '        - name: orders',
          '          port: 8080',
        ),
      ].join('\n---\n'),
      'web/k8s/overlays/production/kustomization.yaml': lines('resources:', '  - ../../base', 'namePrefix: shop-'),
    });
    const read = readManifestsUnder(join(dir, 'web'));
    expect(read.ingresses?.map((each) => `${each.hosts.join(',')} ${each.paths.map((path) => `${path.path}>${path.backends.map((backend) => backend.name).join(',')}`).join(' ')}`)).toEqual([
      'shop-orders.example.test /orders>shop-orders',
    ]);
    expect(read.workloads[0]?.containers[0]?.environment).toEqual([{ name: 'UPSTREAM', raw: 'http://orders:8080' }]);
    expect(read.rows ?? []).toEqual([]);
  });
});

describe('kustomize transformer and generator configurations, helmfile selectors, needs and hooks, and chart imports (P295)', () => {
  const label = (dir: string) => (path: string): string => relative(join(dir, 'deploy'), path).split(sep).join(posix.sep);

  it("runs a kustomization's built-in transformers and generators from their files, and says a plugin it does not run", () => {
    const dir = project({
      'shop/k8s/kustomization.yaml': lines(
        'resources:',
        '  - orders.yaml',
        'generators:',
        '  - generators/settings.yaml',
        'transformers:',
        '  - transformers/prefix.yaml',
        '  - transformers/labels.yaml',
        '  - transformers/namespace.yaml',
        '  - transformers/images.yaml',
        '  - transformers/port.yaml',
        '  - transformers/replicas.yaml',
        '  - transformers/inject.yaml',
      ),
      'shop/k8s/orders.yaml': [
        DEPLOYMENT('orders', 3000, ['          envFrom:', '            - configMapRef:', '                name: orders-settings']),
        lines('apiVersion: v1', 'kind: Service', 'metadata:', '  name: orders', 'spec:', '  ports:', '    - port: 80', '      targetPort: 3000'),
        lines(
          'apiVersion: networking.k8s.io/v1',
          'kind: Ingress',
          'metadata:',
          '  name: edge',
          'spec:',
          '  rules:',
          '    - host: shop.example.test',
          '      http:',
          '        paths:',
          '          - path: /orders',
          '            pathType: Prefix',
          '            backend:',
          '              service:',
          '                name: orders',
          '                port:',
          '                  number: 8080',
        ),
      ].join('\n---\n'),
      'shop/k8s/generators/settings.yaml': lines('apiVersion: builtin', 'kind: ConfigMapGenerator', 'metadata:', '  name: orders-settings', 'literals:', '  - PORT=3000', '  - REGION=eu'),
      'shop/k8s/transformers/prefix.yaml': lines('apiVersion: builtin', 'kind: PrefixSuffixTransformer', 'metadata:', '  name: prefix', 'prefix: shop-', 'fieldSpecs:', '  - path: metadata/name'),
      'shop/k8s/transformers/labels.yaml': lines(
        'apiVersion: builtin',
        'kind: LabelTransformer',
        'metadata:',
        '  name: labels',
        'labels:',
        '  app: orders',
        '  tier: api',
        'fieldSpecs:',
        '  - path: metadata/labels',
        '    create: true',
        '  - kind: Service',
        '    path: spec/selector',
        '    create: true',
        '  - kind: Deployment',
        '    path: spec/template/metadata/labels',
        '    create: true',
      ),
      'shop/k8s/transformers/namespace.yaml': lines('apiVersion: builtin', 'kind: NamespaceTransformer', 'metadata:', '  name: namespace', '  namespace: shop', 'fieldSpecs:', '  - path: metadata/namespace', '    create: true'),
      'shop/k8s/transformers/images.yaml': lines('apiVersion: builtin', 'kind: ImageTagTransformer', 'metadata:', '  name: images', 'imageTag:', '  name: registry.example.test/orders', '  newName: registry.example.test/orders-api'),
      'shop/k8s/transformers/port.yaml': lines(
        'apiVersion: builtin',
        'kind: PatchTransformer',
        'metadata:',
        '  name: port',
        'target:',
        '  kind: Service',
        'patch: |-',
        '  - op: replace',
        '    path: /spec/ports/0/port',
        '    value: 8080',
      ),
      'shop/k8s/transformers/replicas.yaml': lines('apiVersion: builtin', 'kind: ReplicaCountTransformer', 'metadata:', '  name: replicas', 'replica:', '  name: orders', '  count: 3'),
      'shop/k8s/transformers/inject.yaml': lines('apiVersion: tools.example.test/v1', 'kind: SidecarInjector', 'metadata:', '  name: inject'),
    });
    const read = readManifestsUnder(join(dir, 'shop'));
    expect(read.services.map((each) => `${each.namespace}/${each.name} ${JSON.stringify(each.selector)} ${each.ports.map((port) => `${port.port}:${port.target}`).join(',')}`)).toEqual(['shop/shop-orders {"app":"orders","tier":"api"} 8080:3000']);
    expect(read.workloads.map((each) => `${each.namespace}/${each.name} ${JSON.stringify(each.labels)} ${each.containers.map((container) => `${container.image} ${container.environment.map((env) => `${env.name}=${env.raw}`).join(',')}`).join(';')}`)).toEqual([
      'shop/shop-orders {"app":"orders","tier":"api"} orders-api PORT=3000,REGION=eu',
    ]);
    expect(read.ingresses?.map((each) => `${each.namespace}/${each.name} ${each.paths.map((path) => `${path.path}>${path.backends.map((backend) => `${backend.name}:${backend.port}`).join(',')}`).join(' ')}`)).toEqual(['shop/shop-edge /orders>shop-orders:8080']);
    expect(read.rows?.map((row) => `${row.file}:${row.line} ${row.message}`)).toEqual([
      'k8s/transformers/inject.yaml:1 k8s/transformers/inject.yaml configures the transformer SidecarInjector (tools.example.test/v1), an exec or Go plugin kustomize runs; what it does to the resources is not read',
    ]);
  });

  it("writes a kustomization's labels where kustomize does, and the fields its configurations add, a name prefix reaching a gateway a route names by a base's name", () => {
    const dir = project({
      'shop/k8s/base/kustomization.yaml': lines('resources:', '  - orders.yaml', 'commonLabels:', '  app.kubernetes.io/part-of: shop', 'configurations:', '  - gateway-names.yaml'),
      'shop/k8s/base/gateway-names.yaml': lines(
        'nameReference:',
        '  - kind: Gateway',
        '    fieldSpecs:',
        '      - kind: HTTPRoute',
        '        path: spec/parentRefs/name',
        'commonLabels:',
        '  - kind: Service',
        '    path: metadata/annotations',
        '    create: true',
        'namespace:',
        '  - kind: HTTPRoute',
        '    path: spec/parentRefs/namespace',
        '    create: true',
      ),
      'shop/k8s/base/orders.yaml': [
        DEPLOYMENT('orders', 3000),
        lines('apiVersion: v1', 'kind: Service', 'metadata:', '  name: orders', 'spec:', '  ports:', '    - port: 80', '      targetPort: 3000'),
        lines('apiVersion: gateway.networking.k8s.io/v1', 'kind: Gateway', 'metadata:', '  name: edge', 'spec:', '  listeners:', '    - hostname: shop.example.test'),
      ].join('\n---\n'),
      'shop/k8s/production/kustomization.yaml': lines(
        'resources:',
        '  - ../base',
        '  - route.yaml',
        'namePrefix: live-',
        'namespace: production',
        'labels:',
        '  - pairs:',
        '      env: production',
        '    includeTemplates: true',
      ),
      'shop/k8s/production/route.yaml': lines(
        'apiVersion: gateway.networking.k8s.io/v1',
        'kind: HTTPRoute',
        'metadata:',
        '  name: orders',
        'spec:',
        '  parentRefs:',
        '    - name: edge',
        '  rules:',
        '    - matches:',
        '        - path: { type: PathPrefix, value: /orders }',
        '      backendRefs:',
        '        - name: orders',
        '          port: 80',
      ),
    });
    const read = readManifestsUnder(join(dir, 'shop'));
    // commonLabels reach the selector and the pod template; labels: without includeSelectors reaches the pod template only.
    expect(read.services.map((each) => `${each.namespace}/${each.name} ${JSON.stringify(each.selector)}`)).toEqual(['production/live-orders {"app.kubernetes.io/part-of":"shop"}']);
    expect(read.workloads.map((each) => `${each.name} ${JSON.stringify(each.labels)}`)).toEqual(['live-orders {"app":"orders","app.kubernetes.io/part-of":"shop","env":"production"}']);
    // The route is the overlay's; the gateway it names by the base's name is renamed with the prefix, so the route takes its hosts.
    expect(read.ingresses?.map((each) => `${each.name} ${each.hosts.join(',')} ${each.paths.map((path) => `${path.path}>${path.backends.map((backend) => backend.name).join(',')}`).join(' ')}`)).toEqual(['live-orders shop.example.test /orders>orders']);
    expect(read.rows ?? []).toEqual([]);
  });

  it('reads a sub-helmfile with the selectors helmfile gives it under explicit selector inheritance, and says one writing both', () => {
    const chart = (name: string): Record<string, string> => ({
      [`deploy/charts/${name}/Chart.yaml`]: `apiVersion: v2\nname: ${name}\nversion: 0.1.0\n`,
      [`deploy/charts/${name}/templates/service.yaml`]: SERVICE(name, 80, 3000),
    });
    const dir = project({
      ...chart('orders'),
      ...chart('stock'),
      'deploy/helmfile.yaml': lines(
        'helmfiles:',
        '  - path: apps/orders.yaml',
        '  - path: apps/stock.yaml',
        '    selectorsInherited: true',
        '  - path: apps/stock.yaml',
        '    selectors: [tier=web]',
        '    selectorsInherited: true',
      ),
      'deploy/apps/orders.yaml': lines('releases:', '  - name: orders', '    chart: ../charts/orders', '    labels: { tier: web }', '  - name: orders-admin', '    chart: ../charts/orders', '    labels: { tier: admin }'),
      'deploy/apps/stock.yaml': lines('releases:', '  - name: stock', '    chart: ../charts/stock', '    labels: { tier: web }', '  - name: stock-admin', '    chart: ../charts/stock', '    labels: { tier: admin }'),
    });
    const releases = (explicitSelectors: boolean): string[] => readHelmfile(join(dir, 'deploy/helmfile.yaml'), label(dir), { selectors: ['tier=admin'], explicitSelectors }).installs.map((each) => each.release as string);
    // Legacy inheritance: a sub-helmfile writing no selectors takes the command's.
    expect(releases(false)).toEqual(['orders-admin', 'stock-admin']);
    // Explicit inheritance: it keeps every release of its own, and only selectorsInherited takes the command's.
    expect(releases(true)).toEqual(['orders', 'orders-admin', 'stock-admin']);
    expect(readHelmfile(join(dir, 'deploy/helmfile.yaml'), label(dir)).rows.map((row) => `${row.file}:${row.line} ${row.message}`)).toEqual([
      'helmfile.yaml:5 helmfile.yaml is not read from line 5: the sub-helmfile apps/stock.yaml writes both selectors and selectorsInherited, which helmfile refuses',
    ]);
  });

  it('reads the explicit selector inheritance a command runs helmfile with', () => {
    const runs = readHelmfileRuns([
      { words: ['helmfile', '-l', 'tier=api', 'apply'], line: 1, file: 'deploy.sh', env: { HELMFILE_EXPERIMENTAL: 'explicit-selector-inheritance' } },
      { words: ['env', 'HELMFILE_EXPERIMENTAL=true', 'helmfile', 'sync'], line: 2, file: 'deploy.sh' },
      { words: ['helmfile', 'apply'], line: 3, file: 'deploy.sh' },
    ]);
    expect(runs.map((run) => run.explicitSelectors)).toEqual([true, true, false]);
  });

  it("answers a need from another helmfile of the state, and says a release's hooks", () => {
    const dir = project({
      'deploy/charts/orders/Chart.yaml': 'apiVersion: v2\nname: orders\nversion: 0.1.0\n',
      'deploy/helmfile.yaml': lines('helmfiles:', '  - apps/data.yaml', '  - apps/orders.yaml', 'releases:', '  - name: edge', '    chart: ./charts/orders', '    needs: [shop/orders, cache]'),
      'deploy/apps/data.yaml': lines('releases:', '  - name: db', '    namespace: shop', '    chart: ../charts/orders'),
      'deploy/apps/orders.yaml': lines(
        'releases:',
        '  - name: orders',
        '    namespace: shop',
        '    chart: ../charts/orders',
        '    needs: [shop/db]',
        '    hooks:',
        '      - events: [presync]',
        '        command: ./scripts/migrate.sh',
      ),
    });
    const read = readHelmfile(join(dir, 'deploy/helmfile.yaml'), label(dir));
    expect(read.installs.map((each) => `${each.release} ${each.file}:${each.line} needs ${(each.needs ?? []).join(',')}`)).toEqual(['db apps/data.yaml:2 needs ', 'orders apps/orders.yaml:2 needs db', 'edge helmfile.yaml:5 needs orders']);
    expect(read.rows.map((row) => `${row.reason} ${row.file}:${row.line} ${row.message}`)).toEqual([
      'manifest-unread apps/orders.yaml:2 The release orders (apps/orders.yaml:2) runs a hook (presync), commands helmfile runs around the install; a hook is a program that is run, not read, so whatever it applies to the cluster is not drawn',
      'release-need-undefined helmfile.yaml:5 The release edge (helmfile.yaml:5) needs cache, which no release of the helmfile is; helmfile refuses to apply it',
    ]);
  });

  it('hands a chart what its own dependency imports before it hands that up, and says a dependency only a chart repository has', () => {
    const dir = project({
      'deploy/charts/shop/Chart.yaml': lines(
        'apiVersion: v2',
        'name: shop',
        'version: 0.1.0',
        'dependencies:',
        '  - name: api',
        '    repository: file://../api',
        '    import-values:',
        '      - child: service',
        '        parent: api',
        '  - name: queue',
        '    version: 2.0.0',
        '    repository: https://charts.example.test',
        '  - name: metrics',
        '    repository: https://charts.example.test',
        '    condition: metrics.enabled',
      ),
      'deploy/charts/shop/values.yaml': 'metrics:\n  enabled: false\n',
      'deploy/charts/shop/templates/web.yaml': SERVICE('web', 0, 3000).replace('port: 0', 'port: {{ .Values.api.port }}'),
      'deploy/charts/api/Chart.yaml': lines('apiVersion: v2', 'name: api', 'version: 0.1.0', 'dependencies:', '  - name: ports', '    repository: file://../ports', '    import-values:', '      - child: exports.ports', '        parent: service'),
      'deploy/charts/api/values.yaml': 'service:\n  name: api\n',
      'deploy/charts/ports/Chart.yaml': 'apiVersion: v2\nname: ports\nversion: 0.1.0\n',
      'deploy/charts/ports/values.yaml': 'exports:\n  ports:\n    port: 8443\n',
    });
    const read = readManifestsUnder(join(dir, 'deploy'));
    expect(read.services.map((each) => `${each.name} ${each.ports.map((port) => `${port.port}:${port.target}`).join(',')}`)).toEqual(['web 8443:3000']);
    expect(read.rows?.map((row) => `${row.file}:${row.line} ${row.message}`)).toEqual([
      'charts/shop/Chart.yaml:10 charts/shop/Chart.yaml depends on the chart queue 2.0.0 from https://charts.example.test, which nothing has fetched into the project (charts/ holds no queue); no chart repository is read, so its templates are not rendered',
    ]);
  });
});
