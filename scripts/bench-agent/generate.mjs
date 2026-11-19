#!/usr/bin/env node
/**
 * Writes the benchmark's project and its key from one seed (P238).
 *
 *   node scripts/bench-agent/generate.mjs --out <dir> [--seed 1] [--resources 10]
 *
 * The project is TypeScript in eight repositories side by side (see
 * `model.mjs`), with the small declaration stubs the fixtures use instead of
 * an install, so it reads the same on every machine. `key.json` is written
 * from the model, never from a reading of the files: it is what the generator
 * meant. `flowatlas.config.json` is written too, for the arms that have the
 * graph; the arms without it never see that file.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, pascal, singular } from './model.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(ROOT, 'fixtures');

/** The declaration stubs, taken from the fixtures that already read with them. */
const STUBS = {
  '@nestjs/axios': 'multi-repo/gateway/node_modules/@nestjs/axios',
  '@nestjs/config': 'multi-repo/gateway/node_modules/@nestjs/config',
  axios: 'multi-repo/gateway/node_modules/axios',
  rxjs: 'multi-repo/web/node_modules/rxjs',
  typeorm: 'multi-repo/orders/node_modules/typeorm',
  express: 'express-service/api/node_modules/express',
  pg: 'express-service/api/node_modules/pg',
  '@angular/core': 'express-service/web/node_modules/@angular/core',
  '@angular/common': 'express-service/web/node_modules/@angular/common',
  '@types/aws-lambda': 'eventbridge-terraform/circulation/node_modules/@types/aws-lambda',
};
const STUB_FILES = { '@angular/common': ['package.json', 'index.d.ts', 'http/index.d.ts'] };

const lines = (...parts) => `${parts.flat().join('\n')}\n`;

/** The fields every resource's record has, and its write body. */
const recordFields = (resource) => [
  ['id', 'string'],
  ['name', 'string'],
  ['quantity', 'number'],
  ['status', `'draft' | 'active' | 'closed'`],
  ['createdAt', 'string'],
  ['updatedAt', 'string'],
  [`${singular(resource)}Code`, 'string'],
  ['ownerId', 'string'],
];

export const writeProject = (out, options = {}) => {
  const model = buildModel(options);
  rmSync(out, { recursive: true, force: true });
  let written = 0;
  let lineCount = 0;
  const write = (path, text) => {
    const at = join(out, path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, text);
    written += 1;
    lineCount += text.split('\n').length - 1;
  };
  const stub = (repo, name) => {
    const from = join(FIXTURES, STUBS[name]);
    for (const file of STUB_FILES[name] ?? ['package.json', 'index.d.ts']) {
      const at = join(out, repo, 'node_modules', name, file);
      mkdirSync(dirname(at), { recursive: true });
      copyFileSync(join(from, file), at);
    }
  };
  const service = (name) => model.services.find((each) => each.name === name);
  const backends = model.services.filter((each) => each.env !== undefined);
  const nestTsconfig = lines(
    '{',
    '  "compilerOptions": {',
    '    "target": "ES2022",',
    '    "module": "NodeNext",',
    '    "moduleResolution": "NodeNext",',
    '    "experimentalDecorators": true,',
    '    "emitDecoratorMetadata": true,',
    '    "strict": false,',
    '    "skipLibCheck": true,',
    '    "types": []',
    '  },',
    '  "include": ["src"]',
    '}',
  );
  const packageJson = (name, dependencies) => `${JSON.stringify({ name, version: '0.0.0', private: true, dependencies }, null, 2)}\n`;
  /** The rules a resource's records follow: code a service carries that no question is about. */
  const policy = (repo, at, each, resource) => {
    const type = `${pascal(each.name)}${pascal(singular(resource.name))}`;
    write(
      `${repo}/${at}/${singular(resource.name)}.policy.ts`,
      lines(
        `/** Who may change a ${singular(resource.name)}, and when. */`,
        `export interface ${type}Actor {`,
        '  id: string;',
        "  role: 'owner' | 'staff' | 'guest';",
        '}',
        '',
        `export interface ${type}Record {`,
        '  ownerId: string;',
        "  status: 'draft' | 'active' | 'closed';",
        '  quantity: number;',
        '}',
        '',
        `export const canRead${type} = (actor: ${type}Actor, record: ${type}Record): boolean =>`,
        "  actor.role === 'staff' || record.ownerId === actor.id || record.status === 'active';",
        '',
        `export const canChange${type} = (actor: ${type}Actor, record: ${type}Record): boolean => {`,
        "  if (record.status === 'closed') return false;",
        "  if (actor.role === 'staff') return true;",
        "  return actor.role === 'owner' && record.ownerId === actor.id;",
        '};',
        '',
        `export const nextStatusOf${type} = (record: ${type}Record): ${type}Record['status'] => {`,
        "  if (record.status === 'draft') return record.quantity > 0 ? 'active' : 'draft';",
        "  if (record.status === 'active') return record.quantity === 0 ? 'closed' : 'active';",
        "  return 'closed';",
        '};',
        '',
        `export const describe${type} = (record: ${type}Record): string => {`,
        '  const parts: string[] = [];',
        '  parts.push(record.status);',
        "  if (record.quantity === 0) parts.push('empty');",
        "  else if (record.quantity < 5) parts.push('low');",
        "  else parts.push('stocked');",
        "  return parts.join(', ');",
        '};',
      ),
    );
  };

  // The shared types, and the copy each repository carries in place of an install.
  const contracts = [
    '// The types the services and browsers share. Every repository carries a',
    '// byte-identical copy under node_modules/@bench/contracts.',
    '',
  ];
  for (const each of backends) {
    for (const resource of each.resources) {
      const type = `${pascal(each.name)}${pascal(singular(resource.name))}`;
      contracts.push(`export interface ${type}Dto {`, ...recordFields(resource.name).map(([field, kind]) => `  ${field}: ${kind};`), '}', '');
      contracts.push(`export interface Create${type}Dto {`, '  name: string;', '  quantity: number;', `  ownerId?: string;`, '}', '');
      contracts.push(`export interface Update${type}Dto {`, '  name?: string;', '  quantity?: number;', `  status?: ${type}Dto['status'];`, '}', '');
    }
  }
  const contractsText = lines(contracts);
  write('contracts/package.json', `${JSON.stringify({ name: '@bench/contracts', version: '0.0.0', private: true, types: 'src/index.ts' }, null, 2)}\n`);
  write('contracts/src/index.ts', contractsText);
  const carryContracts = (repo) => {
    write(`${repo}/node_modules/@bench/contracts/package.json`, `${JSON.stringify({ name: '@bench/contracts', version: '0.0.0', types: 'index.d.ts' }, null, 2)}\n`);
    write(`${repo}/node_modules/@bench/contracts/index.d.ts`, contractsText.replace(/^export interface/gm, 'export interface'));
  };

  // The NestJS backends.
  for (const each of backends.filter((one) => one.kind === 'nestjs')) {
    const repo = each.repo;
    write(`${repo}/package.json`, packageJson(repo, { '@bench/contracts': 'file:../contracts', '@nestjs/axios': '^4.0.0', '@nestjs/common': '^11.0.0', '@nestjs/config': '^4.0.0', '@nestjs/core': '^11.0.0', '@nestjs/microservices': '^11.0.0', axios: '^1.7.0', rxjs: '^7.8.0', typeorm: '^0.3.0' }));
    write(`${repo}/tsconfig.json`, nestTsconfig);
    for (const name of ['@nestjs/axios', '@nestjs/config', 'axios', 'rxjs', 'typeorm']) stub(repo, name);
    carryContracts(repo);
    const modules = [];
    const constants = model.constants.filter((constant) => constant.service === each.name);
    write(
      `${repo}/src/${each.name}.constants.ts`,
      lines(
        `// Limits the ${each.name} service applies to every list it returns.`,
        ...constants.map((constant) => `export const ${constant.name} = ${constant.value};`),
        'export const MAX_ATTEMPTS = 3;',
        'export const RETRY_DELAY_MS = 250;',
      ),
    );
    for (const resource of each.resources) {
      const type = `${pascal(each.name)}${pascal(singular(resource.name))}`;
      const entity = `${type}Entity`;
      const base = `src/${resource.name}`;
      const constant = constants.find((one) => one.resource === resource.name);
      const published = model.events.filter((event) => event.publisher.className === `${resource.className}Service`);
      modules.push({ resource, base });
      policy(repo, base, each, resource);
      write(
        `${repo}/${base}/${singular(resource.name)}.entity.ts`,
        lines(
          `import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';`,
          '',
          `@Entity('${each.name}_${resource.name}')`,
          `export class ${entity} {`,
          `  @PrimaryGeneratedColumn('uuid')`,
          '  id: string;',
          ...recordFields(resource.name)
            .slice(1)
            .flatMap(([field, kind]) => ['', `  @Column({ type: '${kind === 'number' ? 'int' : 'varchar'}' })`, `  ${field}: ${kind.startsWith("'") ? 'string' : kind};`]),
          '}',
        ),
      );
      write(
        `${repo}/${base}/${singular(resource.name)}.mapper.ts`,
        lines(
          `import type { ${type}Dto } from '@bench/contracts';`,
          '',
          `import type { ${entity} } from './${singular(resource.name)}.entity';`,
          '',
          `/** The record as the ${each.name} service answers with it. */`,
          `export const to${type}Dto = (row: ${entity}): ${type}Dto => ({`,
          ...recordFields(resource.name).map(([field, kind]) => `  ${field}: row.${field}${kind.startsWith("'") ? ` as ${type}Dto['status']` : ''},`),
          '});',
          '',
          `/** Whether a name is one the ${resource.name} list accepts. */`,
          `export const isValid${type}Name = (name: string): boolean => {`,
          '  const trimmed = name.trim();',
          '  if (trimmed.length === 0) return false;',
          '  if (trimmed.length > 120) return false;',
          '  return !/[<>]/.test(trimmed);',
          '};',
          '',
          `/** How the ${resource.name} list is sorted when nothing else is asked for. */`,
          `export const by${type}Name = (a: ${type}Dto, b: ${type}Dto): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);`,
        ),
      );
      const serviceClass = `${resource.className}Service`;
      const writes = (verb) => model.methods.find((method) => method.className === serviceClass && method.method === verb);
      const retried = (verb, body) =>
        writes(verb)?.retries
          ? [
              '    let failure: unknown;',
              '    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {',
              '      try {',
              ...body.map((line) => `    ${line}`),
              '      } catch (error) {',
              '        failure = error;',
              '        await new Promise((done) => setTimeout(done, RETRY_DELAY_MS * (attempt + 1)));',
              '      }',
              '    }',
              '    throw failure;',
            ]
          : body;
      const emit = (verb) =>
        published.filter((event) => event.publisher.method === verb).map((event) => `    this.events.emit('${event.name}', dto);`);
      const actionWrites = writes(resource.action)?.writes === true;
      write(
        `${repo}/${base}/${resource.name}.service.ts`,
        lines(
          `import { Inject, Injectable } from '@nestjs/common';`,
          `import { ClientProxy } from '@nestjs/microservices';`,
          `import { InjectRepository, Repository } from 'typeorm';`,
          '',
          `import type { Create${type}Dto, ${type}Dto, Update${type}Dto } from '@bench/contracts';`,
          '',
          `import { ${constant.name}, MAX_ATTEMPTS, RETRY_DELAY_MS } from '../${each.name}.constants';`,
          `import { ${entity} } from './${singular(resource.name)}.entity';`,
          `import { by${type}Name, isValid${type}Name, to${type}Dto } from './${singular(resource.name)}.mapper';`,
          '',
          '@Injectable()',
          `export class ${serviceClass} {`,
          '  constructor(',
          `    @InjectRepository(${entity})`,
          `    private readonly rows: Repository<${entity}>,`,
          `    @Inject('EVENTS_CLIENT')`,
          '    private readonly events: ClientProxy,',
          '  ) {}',
          '',
          `  async list(page = 0): Promise<${type}Dto[]> {`,
          `    const rows = await this.rows.find({ skip: page * ${constant.name}, take: ${constant.name} });`,
          `    return rows.map(to${type}Dto).sort(by${type}Name);`,
          '  }',
          '',
          `  async findOne(id: string): Promise<${type}Dto> {`,
          '    const row = await this.rows.findOne({ where: { id } });',
          `    if (row === null) throw new Error('${singular(resource.name)} ' + id + ' not found');`,
          `    return to${type}Dto(row);`,
          '  }',
          '',
          `  async create(body: Create${type}Dto): Promise<${type}Dto> {`,
          `    if (!isValid${type}Name(body.name)) throw new Error('invalid name');`,
          ...retried('create', [
            `    const row = await this.rows.save({ name: body.name, quantity: body.quantity, status: 'draft', ownerId: body.ownerId ?? '' } as ${entity});`,
            `    const dto = to${type}Dto(row);`,
            ...emit('create'),
            '    return dto;',
          ]),
          '  }',
          '',
          `  async update(id: string, body: Update${type}Dto): Promise<${type}Dto> {`,
          '    const row = await this.rows.findOne({ where: { id } });',
          `    if (row === null) throw new Error('${singular(resource.name)} ' + id + ' not found');`,
          ...retried('update', [
            `    const saved = await this.rows.save({ ...row, ...body, updatedAt: new Date().toISOString() } as ${entity});`,
            `    const dto = to${type}Dto(saved);`,
            ...emit('update'),
            '    return dto;',
          ]),
          '  }',
          '',
          '  async remove(id: string): Promise<void> {',
          ...retried('remove', ['    await this.rows.delete(id);', '    return;']),
          '  }',
          '',
          `  async ${resource.action}(id: string): Promise<${type}Dto> {`,
          '    const row = await this.rows.findOne({ where: { id } });',
          `    if (row === null) throw new Error('${singular(resource.name)} ' + id + ' not found');`,
          ...(actionWrites
            ? retried(resource.action, [`    const saved = await this.rows.save({ ...row, status: 'closed' } as ${entity});`, `    return to${type}Dto(saved);`])
            : [`    return to${type}Dto(row);`]),
          '  }',
          '}',
        ),
      );
      write(
        `${repo}/${base}/${resource.name}.controller.ts`,
        lines(
          `import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';`,
          '',
          `import type { Create${type}Dto, ${type}Dto, Update${type}Dto } from '@bench/contracts';`,
          '',
          `import { ${serviceClass} } from './${resource.name}.service';`,
          '',
          `@Controller('${resource.name}')`,
          `export class ${resource.className}Controller {`,
          `  constructor(private readonly ${resource.name}: ${serviceClass}) {}`,
          '',
          '  @Get()',
          `  list(@Query('page') page?: string): Promise<${type}Dto[]> {`,
          `    return this.${resource.name}.list(Number(page ?? 0));`,
          '  }',
          '',
          `  @Get(':id')`,
          `  findOne(@Param('id') id: string): Promise<${type}Dto> {`,
          `    return this.${resource.name}.findOne(id);`,
          '  }',
          '',
          '  @Post()',
          `  create(@Body() body: Create${type}Dto): Promise<${type}Dto> {`,
          `    return this.${resource.name}.create({ name: body.name, quantity: body.quantity });`,
          '  }',
          '',
          `  @Patch(':id')`,
          `  update(@Param('id') id: string, @Body() body: Update${type}Dto): Promise<${type}Dto> {`,
          `    return this.${resource.name}.update(id, body);`,
          '  }',
          '',
          `  @Delete(':id')`,
          `  remove(@Param('id') id: string): Promise<void> {`,
          `    return this.${resource.name}.remove(id);`,
          '  }',
          '',
          `  @Post(':id/${resource.action}')`,
          `  ${resource.action}(@Param('id') id: string): Promise<${type}Dto> {`,
          `    return this.${resource.name}.${resource.action}(id);`,
          '  }',
          '}',
        ),
      );
    }
    // The handlers of other services' events, one file per resource they are about.
    const handled = new Map();
    for (const event of model.events) {
      for (const consumer of event.consumers.filter((one) => one.service === each.name)) {
        handled.set(consumer.file, [...(handled.get(consumer.file) ?? []), { event, consumer }]);
      }
    }
    for (const [file, list] of handled) {
      const className = list[0].consumer.className;
      write(
        `${repo}/${file}`,
        lines(
          `import { Controller, Logger } from '@nestjs/common';`,
          `import { EventPattern, Payload } from '@nestjs/microservices';`,
          '',
          `/** What ${each.name} does when another service says something changed. */`,
          '@Controller()',
          `export class ${className} {`,
          `  private readonly log = new Logger('${className}');`,
          '',
          ...list.flatMap(({ event, consumer }) => [
            `  @EventPattern('${event.name}')`,
            `  async ${consumer.method}(@Payload() event: { id: string; name: string }): Promise<void> {`,
            `    this.log.log('${event.name} ' + event.id + ' ' + event.name);`,
            '  }',
            '',
          ]),
          '}',
        ),
      );
      modules.push({ handler: { className, file } });
    }
    // The calls this backend makes to the others.
    const outbound = each.outbound ?? [];
    const byTarget = new Map();
    for (const call of outbound) byTarget.set(call.file, [...(byTarget.get(call.file) ?? []), call]);
    for (const [file, list] of byTarget) {
      const target = service(list[0].to);
      write(
        `${repo}/${file}`,
        lines(
          `import { Injectable } from '@nestjs/common';`,
          `import { HttpService } from '@nestjs/axios';`,
          `import { ConfigService } from '@nestjs/config';`,
          `import { firstValueFrom } from 'rxjs';`,
          '',
          `/** How ${each.name} reaches ${target.name}, at the address ${target.env} holds. */`,
          '@Injectable()',
          `export class ${list[0].clientClass} {`,
          '  constructor(',
          '    private readonly http: HttpService,',
          '    private readonly config: ConfigService,',
          '  ) {}',
          '',
          ...list.flatMap((call) => [
            `  async ${call.symbol.split('.')[1]}(${call.route.path.includes(':id') ? 'id: string, ' : ''}body: { name: string; quantity: number }): Promise<unknown> {`,
            `    const answer = await firstValueFrom(this.http.post<unknown>(\`\${this.config.get('${target.env}')}${call.route.path.replace(':id', '${id}')}\`, body));`,
            '    return answer.data;',
            '  }',
            '',
          ]),
          '}',
        ),
      );
      modules.push({ client: { className: list[0].clientClass, file } });
    }
    write(
      `${repo}/src/app.module.ts`,
      lines(
        `import { Module } from '@nestjs/common';`,
        `import { HttpModule } from '@nestjs/axios';`,
        `import { ConfigModule } from '@nestjs/config';`,
        '',
        ...modules.flatMap((one) =>
          one.resource !== undefined
            ? [
                `import { ${one.resource.className}Controller } from './${one.resource.name}/${one.resource.name}.controller';`,
                `import { ${one.resource.className}Service } from './${one.resource.name}/${one.resource.name}.service';`,
              ]
            : one.handler !== undefined
              ? [`import { ${one.handler.className} } from './${one.handler.file.slice(4, -3)}';`]
              : [`import { ${one.client.className} } from './${one.client.file.slice(4, -3)}';`],
        ),
        '',
        '@Module({',
        '  imports: [HttpModule, ConfigModule.forRoot()],',
        `  controllers: [${modules.flatMap((one) => (one.resource !== undefined ? [`${one.resource.className}Controller`] : one.handler !== undefined ? [one.handler.className] : [])).join(', ')}],`,
        `  providers: [${modules.flatMap((one) => (one.resource !== undefined ? [`${one.resource.className}Service`] : one.client !== undefined ? [one.client.className] : [])).join(', ')}],`,
        '})',
        `export class ${pascal(each.name)}Module {}`,
      ),
    );
    write(
      `${repo}/src/main.ts`,
      lines(
        `import { NestFactory } from '@nestjs/core';`,
        '',
        `import { ${pascal(each.name)}Module } from './app.module';`,
        '',
        'const start = async (): Promise<void> => {',
        `  const app = await NestFactory.create(${pascal(each.name)}Module);`,
        '  await app.listen(Number(process.env.PORT ?? 3000));',
        '};',
        '',
        'void start();',
      ),
    );
  }

  // The Express backend.
  {
    const each = backends.find((one) => one.kind === 'express');
    const repo = each.repo;
    write(`${repo}/package.json`, packageJson(repo, { '@bench/contracts': 'file:../contracts', express: '^4.21.0', pg: '^8.12.0' }));
    write(`${repo}/tsconfig.json`, lines('{', '  "compilerOptions": { "target": "ES2022", "module": "commonjs", "strict": true, "esModuleInterop": true, "skipLibCheck": true },', '  "include": ["src"]', '}'));
    stub(repo, 'express');
    stub(repo, 'pg');
    carryContracts(repo);
    const constants = model.constants.filter((constant) => constant.service === each.name);
    write(`${repo}/src/${each.name}.constants.ts`, lines(`// Limits the ${each.name} service applies to every list it returns.`, ...constants.map((constant) => `export const ${constant.name} = ${constant.value};`), 'export const MAX_ATTEMPTS = 3;'));
    const mounts = [];
    for (const resource of each.resources) {
      const type = `${pascal(each.name)}${pascal(singular(resource.name))}`;
      const store = `${resource.className}Store`;
      const constant = constants.find((one) => one.resource === resource.name);
      const routesConst = `${resource.name}Routes`;
      mounts.push({ resource, routesConst });
      policy(repo, `src/${resource.name}`, each, resource);
      const writes = (verb) => model.methods.find((method) => method.className === `${resource.className}Service` && method.method === verb);
      const retried = (verb, call) =>
        writes(verb)?.retries
          ? ['    for (let attempt = 1; ; attempt += 1) {', '      try {', `        return await ${call};`, '      } catch (error) {', '        if (attempt >= MAX_ATTEMPTS) throw error;', '      }', '    }']
          : [`    return ${call};`];
      write(
        `${repo}/src/${resource.name}/${resource.name}.service.ts`,
        lines(
          `import { Pool } from 'pg';`,
          '',
          `import { ${constant.name}, MAX_ATTEMPTS } from '../${each.name}.constants';`,
          '',
          `/** The ${resource.name} table, and what may be done to it. */`,
          `export class ${resource.className}Service {`,
          '  private readonly pool = new Pool();',
          '',
          '  async list(page: number): Promise<unknown> {',
          `    return this.pool.query('select * from ${resource.name} order by name limit $1 offset $2', [${constant.name}, page * ${constant.name}]);`,
          '  }',
          '',
          '  async findOne(id: string): Promise<unknown> {',
          `    return this.pool.query('select * from ${resource.name} where id = $1', [id]);`,
          '  }',
          '',
          '  async create(name: string, quantity: number): Promise<unknown> {',
          ...retried('create', `this.pool.query('insert into ${resource.name} (name, quantity) values ($1, $2)', [name, quantity])`),
          '  }',
          '',
          '  async update(id: string, name: string): Promise<unknown> {',
          ...retried('update', `this.pool.query('update ${resource.name} set name = $2 where id = $1', [id, name])`),
          '  }',
          '',
          '  async remove(id: string): Promise<unknown> {',
          ...retried('remove', `this.pool.query('delete from ${resource.name} where id = $1', [id])`),
          '  }',
          '',
          `  async ${resource.action}(id: string): Promise<unknown> {`,
          ...(writes(resource.action)?.writes ? retried(resource.action, `this.pool.query('update ${resource.name} set status = $2 where id = $1', [id, 'closed'])`) : [`    return this.pool.query('select * from ${resource.name} where id = $1', [id]);`]),
          '  }',
          '}',
          '',
          `export const ${store} = new ${resource.className}Service();`,
        ),
      );
      write(
        `${repo}/src/${resource.name}/${resource.name}.routes.ts`,
        lines(
          `import { Router, type Request, type Response } from 'express';`,
          '',
          `import type { Create${type}Dto } from '@bench/contracts';`,
          '',
          `import { ${store} } from './${resource.name}.service';`,
          '',
          `export const ${routesConst} = Router();`,
          '',
          `${routesConst}.get('/', async (req: Request, res: Response): Promise<unknown> => res.json(await ${store}.list(Number(req.query['page'] ?? 0))));`,
          `${routesConst}.get('/:id', async (req: Request, res: Response): Promise<unknown> => res.json(await ${store}.findOne(req.params['id'] as string)));`,
          `${routesConst}.post('/', async (req: Request<unknown, unknown, Create${type}Dto>, res: Response): Promise<unknown> => {`,
          `  const created = await ${store}.create(req.body.name, req.body.quantity);`,
          '  return res.status(201).json(created);',
          '});',
          `${routesConst}.patch('/:id', async (req: Request, res: Response): Promise<unknown> => res.json(await ${store}.update(req.params['id'] as string, req.body.name)));`,
          `${routesConst}.delete('/:id', async (req: Request, res: Response): Promise<unknown> => {`,
          `  await ${store}.remove(req.params['id'] as string);`,
          '  return res.status(204).send();',
          '});',
          `${routesConst}.post('/:id/${resource.action}', async (req: Request, res: Response): Promise<unknown> => res.json(await ${store}.${resource.action}(req.params['id'] as string)));`,
        ),
      );
    }
    write(
      `${repo}/src/app.ts`,
      lines(
        `import express from 'express';`,
        '',
        ...mounts.map((one) => `import { ${one.routesConst} } from './${one.resource.name}/${one.resource.name}.routes';`),
        '',
        'export const app = express();',
        'app.use(express.json());',
        ...mounts.map((one) => `app.use('/${one.resource.name}', ${one.routesConst});`),
        'app.listen(Number(process.env.PORT ?? 3000));',
      ),
    );
  }

  // The Lambda backend, its ways in declared in Terraform.
  {
    const each = backends.find((one) => one.kind === 'lambda');
    const repo = each.repo;
    write(`${repo}/package.json`, `${JSON.stringify({ name: repo, version: '0.0.0', private: true, devDependencies: { '@types/aws-lambda': '^8.10.140' } }, null, 2)}\n`);
    write(`${repo}/tsconfig.json`, lines('{', '  "compilerOptions": { "target": "ES2022", "module": "commonjs", "rootDir": "src", "outDir": "dist", "strict": true, "esModuleInterop": true, "skipLibCheck": true },', '  "include": ["src"]', '}'));
    stub(repo, '@types/aws-lambda');
    const constants = model.constants.filter((constant) => constant.service === each.name);
    write(`${repo}/src/lib/${each.name}.constants.ts`, lines(`// Limits the ${each.name} functions apply.`, ...constants.map((constant) => `export const ${constant.name} = ${constant.value};`)));
    const tf = [];
    const fns = [];
    for (const resource of each.resources) {
      for (const route of resource.routes) {
        const fn = `${route.verb}-${resource.name}`.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
        const id = fn.replace(/-/g, '_');
        fns.push(
          `resource "aws_lambda_function" "${id}" {`,
          `  function_name    = "\${local.prefix}-${fn}"`,
          '  role             = aws_iam_role.lambda.arn',
          '  runtime          = "nodejs20.x"',
          `  handler          = "${resource.name}/${fn}.handler"`,
          '  filename         = data.archive_file.functions.output_path',
          '  source_code_hash = data.archive_file.functions.output_base64sha256',
          '}',
          '',
        );
        tf.push(
          `resource "aws_apigatewayv2_integration" "${id}" {`,
          `  api_id                 = aws_apigatewayv2_api.${each.name}.id`,
          '  integration_type       = "AWS_PROXY"',
          `  integration_uri        = aws_lambda_function.${id}.invoke_arn`,
          '  payload_format_version = "2.0"',
          '}',
          '',
          `resource "aws_apigatewayv2_route" "${id}" {`,
          `  api_id    = aws_apigatewayv2_api.${each.name}.id`,
          `  route_key = "${route.method} ${route.path.replace(':id', '{id}')}"`,
          `  target    = "integrations/\${aws_apigatewayv2_integration.${id}.id}"`,
          '}',
          '',
        );
        const constant = constants.find((one) => one.resource === resource.name);
        write(
          `${repo}/src/${resource.name}/${fn}.ts`,
          lines(
            `import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';`,
            '',
            `import { ${constant.name} } from '../lib/${each.name}.constants';`,
            '',
            `/** ${route.method} ${route.path}: ${route.verb} on the ${resource.name} list. */`,
            'export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {',
            `  const body = JSON.parse(event.body ?? '{}') as { name?: string; quantity?: number };`,
            `  const limit = ${constant.name};`,
            `  return { statusCode: ${route.method === 'POST' ? 201 : 200}, body: JSON.stringify({ ok: true, limit, name: body.name ?? null }) };`,
            '};',
          ),
        );
      }
    }
    write(
      `${repo}/infra/main.tf`,
      lines(
        'terraform {',
        '  required_providers {',
        '    aws = {',
        '      source  = "hashicorp/aws"',
        '      version = "~> 5.0"',
        '    }',
        '  }',
        '}',
        '',
        'locals {',
        `  prefix = "${each.name}"`,
        '}',
        '',
        'data "archive_file" "functions" {',
        '  type        = "zip"',
        '  source_dir  = "${path.module}/../dist"',
        '  output_path = "${path.module}/build/functions.zip"',
        '}',
        '',
        'resource "aws_iam_role" "lambda" {',
        `  name               = "${each.name}-lambda"`,
        '  assume_role_policy = "{}"',
        '}',
        '',
        `resource "aws_apigatewayv2_api" "${each.name}" {`,
        `  name          = "${each.name}"`,
        '  protocol_type = "HTTP"',
        '}',
      ),
    );
    write(`${repo}/infra/functions.tf`, lines(fns));
    write(`${repo}/infra/api.tf`, lines(tf));
  }

  // The gateway.
  {
    const gateway = service('gateway');
    const repo = gateway.repo;
    write(`${repo}/package.json`, packageJson(repo, { '@bench/contracts': 'file:../contracts', '@nestjs/axios': '^4.0.0', '@nestjs/common': '^11.0.0', '@nestjs/config': '^4.0.0', '@nestjs/core': '^11.0.0', axios: '^1.7.0', rxjs: '^7.8.0' }));
    write(`${repo}/tsconfig.json`, nestTsconfig);
    for (const name of ['@nestjs/axios', '@nestjs/config', 'axios', 'rxjs']) stub(repo, name);
    carryContracts(repo);
    const settingsProxy = gateway.proxies.find((proxy) => proxy.via === 'settings');
    const settingsTarget = service(settingsProxy.service);
    write(
      `${repo}/src/settings.ts`,
      lines(
        '/** Addresses the gateway reads once, at start-up. */',
        'export const settings = {',
        `  ${settingsTarget.name}Base: process.env.${settingsTarget.env} ?? 'http://${settingsTarget.name}.internal',`,
        "  timeoutMs: Number(process.env.GATEWAY_TIMEOUT_MS ?? 5000),",
        '};',
      ),
    );
    write(
      `${repo}/src/clients/forward.ts`,
      lines(
        `import type { HttpService } from '@nestjs/axios';`,
        `import { firstValueFrom } from 'rxjs';`,
        '',
        '/** One request on to a service, answered with its body. */',
        'export const forward = async <T>(http: HttpService, method: string, url: string, body?: unknown): Promise<T> => {',
        "  const answer = await firstValueFrom(method === 'GET' ? http.get<T>(url) : method === 'DELETE' ? http.delete<T>(url) : method === 'PATCH' ? http.patch<T>(url, body) : http.post<T>(url, body));",
        '  return answer.data;',
        '};',
      ),
    );
    const modules = [];
    for (const proxy of gateway.proxies) {
      const target = service(proxy.service);
      const type = (resource) => `${pascal(target.name)}${pascal(singular(resource))}`;
      const t = type(proxy.resource);
      const field = model.fields.find((one) => one.caller === `${proxy.clientClass}.create`);
      const base =
        proxy.via === 'settings' ? `\${settings.${target.name}Base}` : `\${this.config.get('${target.env}')}`;
      const call = (method, path, body) => {
        const url = `\`${base}${path}\``;
        if (proxy.via === 'helper') return `    return forward<${t}Dto>(this.http, '${method}', ${url}${body === undefined ? '' : `, ${body}`});`;
        const verb = method.toLowerCase();
        return `    return firstValueFrom(this.http.${verb}<${t}Dto>(${url}${body === undefined ? '' : `, ${body}`})).then((answer) => answer.data);`;
      };
      const pathOf = (route) => route.path.replace(':id', '${id}');
      write(
        `${repo}/${proxy.clientFile}`,
        lines(
          `import { Injectable } from '@nestjs/common';`,
          `import { HttpService } from '@nestjs/axios';`,
          `import { ConfigService } from '@nestjs/config';`,
          `import { firstValueFrom } from 'rxjs';`,
          '',
          `import type { ${t}Dto } from '@bench/contracts';`,
          '',
          ...(proxy.via === 'helper' ? [`import { forward } from './forward';`] : []),
          ...(proxy.via === 'settings' ? [`import { settings } from '../settings';`] : []),
          '',
          `/** The ${proxy.resource} of ${target.name}, as the gateway asks for them. */`,
          '@Injectable()',
          `export class ${proxy.clientClass} {`,
          '  constructor(',
          '    private readonly http: HttpService,',
          '    private readonly config: ConfigService,',
          '  ) {}',
          '',
          ...proxy.routes.flatMap(({ route }) => {
            const takesId = route.path.includes(':id');
            const takesBody = route.verb === 'create' || route.verb === 'update';
            const params = [takesId ? 'id: string' : undefined, takesBody ? 'body: { name: string; quantity: number }' : undefined].filter(Boolean).join(', ');
            const body =
              route.verb === 'create' ? (field?.sent.includes('qty') ? '{ name: body.name, qty: body.quantity }' : '{ name: body.name, quantity: body.quantity }') : takesBody ? 'body' : undefined;
            return [`  ${route.verb}(${params}): Promise<${route.verb === 'list' ? `${t}Dto[]` : `${t}Dto`}> {`, call(route.method, pathOf(route), body).replace(`<${t}Dto>`, route.verb === 'list' ? `<${t}Dto[]>` : `<${t}Dto>`), '  }', ''];
          }),
          '}',
        ),
      );
      write(
        `${repo}/${proxy.controllerFile}`,
        lines(
          `import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';`,
          '',
          `import type { ${t}Dto } from '@bench/contracts';`,
          '',
          `import { ${proxy.clientClass} } from '../clients/${proxy.service}-${proxy.resource}.client';`,
          '',
          `@Controller('api/${proxy.service}/${proxy.resource}')`,
          `export class ${proxy.controllerClass} {`,
          `  constructor(private readonly client: ${proxy.clientClass}) {}`,
          '',
          ...proxy.routes.flatMap(({ route }) => {
            const decorator = { GET: 'Get', POST: 'Post', PATCH: 'Patch', DELETE: 'Delete' }[route.method];
            const sub = route.path.slice(proxy.resource.length + 2);
            const takesId = route.path.includes(':id');
            const takesBody = route.verb === 'create' || route.verb === 'update';
            const params = [takesId ? `@Param('id') id: string` : undefined, takesBody ? '@Body() body: { name: string; quantity: number }' : undefined].filter(Boolean).join(', ');
            const args = [takesId ? 'id' : undefined, takesBody ? 'body' : undefined].filter(Boolean).join(', ');
            return [`  @${decorator}(${sub === '' ? '' : `'${sub}'`})`, `  ${route.verb}(${params}): Promise<${route.verb === 'list' ? `${t}Dto[]` : `${t}Dto`}> {`, `    return this.client.${route.verb}(${args});`, '  }', ''];
          }),
          '}',
        ),
      );
      modules.push(proxy);
    }
    write(
      `${repo}/src/app.module.ts`,
      lines(
        `import { Module } from '@nestjs/common';`,
        `import { HttpModule } from '@nestjs/axios';`,
        `import { ConfigModule } from '@nestjs/config';`,
        '',
        ...modules.flatMap((proxy) => [
          `import { ${proxy.clientClass} } from './clients/${proxy.service}-${proxy.resource}.client';`,
          `import { ${proxy.controllerClass} } from './${proxy.service}/${proxy.service}-${proxy.resource}.controller';`,
        ]),
        '',
        '@Module({',
        '  imports: [HttpModule, ConfigModule.forRoot()],',
        `  controllers: [${modules.map((proxy) => proxy.controllerClass).join(', ')}],`,
        `  providers: [${modules.map((proxy) => proxy.clientClass).join(', ')}],`,
        '})',
        'export class GatewayModule {}',
      ),
    );
    write(`${repo}/src/main.ts`, lines(`import { NestFactory } from '@nestjs/core';`, '', `import { GatewayModule } from './app.module';`, '', 'const start = async (): Promise<void> => {', '  const app = await NestFactory.create(GatewayModule);', '  await app.listen(Number(process.env.PORT ?? 8080));', '};', '', 'void start();'));
  }

  // The React storefront.
  {
    const web = service('web');
    write(`web/package.json`, packageJson('web', { '@bench/contracts': 'file:../contracts', react: '^19.0.0' }));
    write(`web/tsconfig.json`, lines('{', '  "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true, "skipLibCheck": true, "types": [] },', '  "include": ["src"]', '}'));
    carryContracts('web');
    write('web/.env.example', lines('# Where the storefront sends its requests.', 'VITE_API_URL=https://gateway.bench.test'));
    for (const screen of web.screens) {
      const key = screen.file.split('/')[1];
      write(
        `web/${screen.api}`,
        lines(
          ...screen.routes.map((route) => {
            const symbol = route.callers.find((caller) => caller.service === 'web').symbol;
            const takesId = route.path.includes(':id');
            const url = `\`\${import.meta.env.VITE_API_URL}${route.path.replace(':id', '${id}')}\``;
            const init = route.method === 'GET' ? '' : `, { method: '${route.method}'${route.verb === 'create' || route.verb === 'update' ? `, body: JSON.stringify({ name, quantity: 1 })` : ''} }`;
            const params = [takesId ? 'id: string' : undefined, route.verb === 'create' || route.verb === 'update' ? 'name: string' : undefined].filter(Boolean).join(', ');
            return `export const ${symbol} = (${params}): Promise<Response> => fetch(${url}${init});\n`;
          }),
        ),
      );
      const symbols = screen.routes.map((route) => route.callers.find((caller) => caller.service === 'web').symbol);
      write(
        `web/${screen.file}`,
        lines(
          `import { ${symbols.join(', ')} } from './${key}.api';`,
          '',
          `/** The ${key.replace('-', ' ')} screen of the storefront. */`,
          `export const ${screen.component} = () => {`,
          ...symbols.map((symbol, index) => {
            const route = screen.routes[index];
            const args = [route.path.includes(':id') ? "'current'" : undefined, route.verb === 'create' || route.verb === 'update' ? "'new name'" : undefined].filter(Boolean).join(', ');
            return `  const on${pascal(symbol)} = () => ${symbol}(${args});`;
          }),
          '  return (',
          '    <section>',
          ...symbols.map((symbol) => `      <button onClick={on${pascal(symbol)}}>${symbol}</button>`),
          '    </section>',
          '  );',
          '};',
        ),
      );
    }
  }

  // The Angular back office.
  {
    const admin = service('admin');
    write(`admin/package.json`, packageJson('admin', { '@angular/common': '^19.0.0', '@angular/core': '^19.0.0', '@bench/contracts': 'file:../contracts', rxjs: '^7.8.0' }));
    write(`admin/tsconfig.json`, nestTsconfig);
    for (const name of ['@angular/core', '@angular/common', 'rxjs']) stub('admin', name);
    carryContracts('admin');
    write('admin/src/environments/environment.ts', lines('export const environment = {', '  production: false,', "  apiUrl: 'https://gateway.bench.test',", '};'));
    for (const screen of admin.screens) {
      const key = screen.file.split('/')[2];
      write(
        `admin/${screen.api}`,
        lines(
          `import { HttpClient } from '@angular/common/http';`,
          `import { Injectable } from '@angular/core';`,
          `import { Observable } from 'rxjs';`,
          '',
          `import { environment } from '../../environments/environment';`,
          '',
          `@Injectable({ providedIn: 'root' })`,
          `export class ${screen.apiClass} {`,
          '  constructor(private readonly http: HttpClient) {}',
          '',
          ...screen.routes.flatMap((route) => {
            const takesId = route.path.includes(':id');
            const takesBody = route.verb === 'create' || route.verb === 'update';
            const params = [takesId ? 'id: string' : undefined, takesBody ? 'name: string' : undefined].filter(Boolean).join(', ');
            const url = `\`\${environment.apiUrl}${route.path.replace(':id', '${id}')}\``;
            const verb = route.method.toLowerCase();
            return [`  ${route.verb}(${params}): Observable<unknown> {`, `    return this.http.${verb}(${url}${takesBody ? ', { name, quantity: 1 }' : ''});`, '  }', ''];
          }),
          '}',
        ),
      );
      write(
        `admin/${screen.file}`,
        lines(
          `import { Component } from '@angular/core';`,
          '',
          `import { ${screen.apiClass} } from './${key}-api.service';`,
          '',
          '@Component({',
          `  selector: 'app-${key}',`,
          `  template: '<section>${key}</section>',`,
          '})',
          `export class ${screen.component} {`,
          `  constructor(private readonly api: ${screen.apiClass}) {}`,
          '',
          ...screen.routes.flatMap((route) => {
            const args = [route.path.includes(':id') ? "'current'" : undefined, route.verb === 'create' || route.verb === 'update' ? "'new name'" : undefined].filter(Boolean).join(', ');
            return [`  ${route.verb}(): void {`, `    this.api.${route.verb}(${args}).subscribe();`, '  }', ''];
          }),
          '}',
        ),
      );
    }
  }

  // The configuration the graph arms build from.
  const config = {
    services: [
      ...model.services
        .filter((each) => each.kind !== 'react' && each.kind !== 'angular')
        .map((each) => ({
          name: each.name,
          repo: `./${each.repo}`,
          type: each.kind,
          ...(each.env === undefined ? {} : { baseUrlEnv: [each.env], hosts: [`${each.name}.internal`] }),
          ...(each.name === 'gateway' ? { hosts: ['gateway.bench.test'] } : {}),
        })),
      { name: 'web', repo: './web', type: 'react', apiBaseEnv: ['VITE_API_URL'], apiTarget: { VITE_API_URL: 'gateway' } },
      { name: 'admin', repo: './admin', type: 'angular', apiBaseEnv: ['apiUrl'], apiTarget: { apiUrl: 'gateway' } },
    ],
    sharedPackages: ['@bench/contracts'],
    output: '.flowatlas',
  };
  write('flowatlas.config.json', `${JSON.stringify(config, null, 2)}\n`);
  const key = keyOf(model);
  write('key.json', `${JSON.stringify(key, null, 2)}\n`);
  return { model, key, files: written, lines: lineCount };
};

/**
 * The key: what is true of the project, from the model alone. The questions
 * are asked of it (`questions.mjs`); it is never read by an arm.
 */
export const keyOf = (model) => ({
  keyFormatVersion: 1,
  seed: model.seed,
  resources: model.resources,
  services: model.services.map((each) => ({ name: each.name, kind: each.kind, repo: each.repo })),
  routes: model.routes.map((route) => ({
    id: route.id,
    service: route.service,
    method: route.method,
    path: route.path,
    handler: route.handler,
    writes: route.writes,
    callers: route.callers,
    ...(route.backend === undefined ? {} : { backend: route.backend }),
  })),
  events: model.events,
  constants: model.constants,
  methods: model.methods,
  fields: model.fields,
  calls: model.calls,
  traps: model.traps,
});

const argument = (argv, name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? fallback : argv[at + 1];
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const out = argument(argv, 'out');
  if (out === undefined) {
    process.stderr.write('usage: generate.mjs --out <dir> [--seed 1] [--resources 10]\n');
    process.exit(2);
  }
  const done = writeProject(resolve(out), { seed: Number(argument(argv, 'seed', '1')), resources: Number(argument(argv, 'resources', '10')) });
  process.stdout.write(`${done.files} files, ${done.lines} lines, ${done.key.routes.length} routes, ${done.key.events.length} events\n`);
}
