import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readManifestsUnder } from './cluster.js';
import { packageScriptLines, readHelmInstalls, readPortForwards, scriptLines } from './docker-run.js';
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

describe('the commands a script runs against a cluster (P260)', () => {
  it('reads a chart installed with its values files, sets, release and namespace', () => {
    const make = lines('deploy:', '\thelm upgrade --install orders ./charts/orders \\', '\t  -f charts/orders/values-prod.yaml --set service.port=80 -n shop', 'render:', '\t@helm template ./charts/orders --values=a.yaml,b.yaml');
    expect(readHelmInstalls(scriptLines(make))).toEqual([
      { release: 'orders', chart: './charts/orders', namespace: 'shop', values: ['charts/orders/values-prod.yaml'], sets: ['service.port=80'], line: 2 },
      { chart: './charts/orders', values: ['a.yaml', 'b.yaml'], sets: [], line: 5 },
    ]);
    expect(readHelmInstalls(packageScriptLines(JSON.stringify({ scripts: { deploy: 'helm install $RELEASE ./chart' } })))).toEqual([{ chart: './chart', values: [], sets: [], line: 1 }]);
  });

  it('reads the ports a port-forward makes this machine reach', () => {
    const script = lines('kubectl port-forward svc/orders 8080:80 -n shop &', 'kubectl -n shop port-forward deploy/stock 4000', 'kubectl port-forward pod/x 1:2', 'kubectl port-forward svc/billing :80');
    expect(readPortForwards(scriptLines(script))).toEqual([
      { kind: 'service', name: 'orders', namespace: 'shop', local: 8080, remote: 80, line: 1 },
      { kind: 'workload', name: 'stock', local: 4000, remote: 4000, line: 2 },
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
        paths: [{ match: 'pattern', path: '^/api(/|$)(.*)', flags: 'i', backends: [{ name: 'orders', port: 'web' }], rewrite: { kind: 'pattern', source: '^/api(/|$)(.*)', flags: 'i', with: '/$2' }, file: 'k8s/ingress.yaml', line: 12 }],
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
