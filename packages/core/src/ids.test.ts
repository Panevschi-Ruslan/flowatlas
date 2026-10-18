import { describe, expect, it } from 'vitest';
import { InvalidChannelNameError, InvalidIdError } from './errors.js';
import {
  entryReferenceOf,
  makeChannelId,
  makeEntryId,
  makeEntryReference,
  makeHttpEntryKey,
  makeStateId,
  makeSymbolId,
  makeWorkflowEntryKey,
  makeTypeId,
  isBelowDir,
  isWithinDir,
  normalizeFilePath,
  normalizePath,
} from './ids.js';
import { isExternalFile } from './nodes.js';
import { packageOfPath } from './origin.js';

describe('normalizePath', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['', '/'],
    ['/', '/'],
    ['//', '/'],
    ['orders', '/orders'],
    ['/orders', '/orders'],
    ['/orders/', '/orders'],
    ['//orders//items//', '/orders/items'],
    ['/orders/:id', '/orders/:param'],
    ['/orders/{id}', '/orders/:param'],
    ['/orders/<id>', '/orders/:param'],
    ['/orders/:orderId/items/:itemId', '/orders/:param/items/:param'],
    ['orders/{id}/items/<itemId>/', '/orders/:param/items/:param'],
    ['/orders/:id?', '/orders/:param'],
    ['/orders/:id(\\d+)', '/orders/:param'],
    ['/files/*', '/files/*'],
    ['/orders/:param', '/orders/:param'],
    ['/Orders/Items', '/Orders/Items'],
    ['  /orders/:id  ', '/orders/:param'],
    ['/a/{}/b', '/a/:param/b'],
    ['/health', '/health'],
  ];

  it.each(cases)('normalizes %j to %j', (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const [input] of cases) {
      expect(normalizePath(normalizePath(input))).toBe(normalizePath(input));
    }
  });
});

describe('normalizeFilePath', () => {
  it('converts separators to POSIX', () => {
    expect(normalizeFilePath('src\\dto\\create.dto.ts')).toBe('src/dto/create.dto.ts');
  });

  it('makes a path inside the repo relative to it', () => {
    expect(normalizeFilePath('/repos/orders/src/app.ts', '/repos/orders')).toBe('src/app.ts');
  });

  it('tolerates a trailing slash on the repo directory', () => {
    expect(normalizeFilePath('/repos/orders/src/app.ts', '/repos/orders/')).toBe('src/app.ts');
  });

  it('climbs out of the repo for a path beside it', () => {
    // A file of a workspace package the service reads. Naming it relative to the
    // service keeps one machine's absolute paths out of the graph's ids.
    expect(normalizeFilePath('/repos/packages/lib/x.ts', '/repos/orders')).toBe(
      '../packages/lib/x.ts',
    );
  });

  it('climbs all the way out for a path that shares nothing', () => {
    expect(normalizeFilePath('/elsewhere/app.ts', '/repos/orders')).toBe(
      '../../elsewhere/app.ts',
    );
  });

  it('strips a leading ./ and collapses repeated slashes', () => {
    expect(normalizeFilePath('./src//app.ts')).toBe('src/app.ts');
  });
});

describe('id constructors', () => {
  it('builds the symbol id forms from the plan', () => {
    expect(makeSymbolId('orders', 'src/orders.service.ts', 'OrdersService', 'create')).toBe(
      'orders#src/orders.service.ts:OrdersService.create',
    );
    expect(makeSymbolId('orders', 'src/orders.service.ts', 'OrdersService')).toBe(
      'orders#src/orders.service.ts:OrdersService',
    );
    expect(makeSymbolId('orders', 'src/util.ts', 'toCents')).toBe('orders#src/util.ts:toCents');
  });

  it('normalizes the file part of a symbol id', () => {
    expect(makeSymbolId('orders', './src\\a.ts', 'A')).toBe('orders#src/a.ts:A');
  });

  it('builds the entry ids from the plan', () => {
    expect(makeEntryId('orders', 'http', makeHttpEntryKey('POST', '/orders/:id'))).toBe(
      'entry:orders:http:POST:/orders/:param',
    );
    expect(makeEntryId('bot', 'bot_callback', 'order_confirm')).toBe(
      'entry:bot:bot_callback:order_confirm',
    );
  });

  // An address is only an address within an application (R119). One service that
  // creates two of them has two address spaces, and the qualifier is absent for
  // the one that creates a single application, because naming the only
  // application there is adds a word and no information.
  it('carries the application when one was named', () => {
    expect(makeEntryId('orders', 'http', makeHttpEntryKey('GET', '/health'), 'WorkerModule')).toBe(
      'entry:orders@WorkerModule:http:GET:/health',
    );
  });

  it('leaves the key half in the position anything reading it expects', () => {
    const id = makeEntryId('orders', 'http', makeHttpEntryKey('GET', '/health'), 'WorkerModule');
    expect(id.split(':').slice(3).join(':')).toBe('GET:/health');
  });

  it('rejects an empty application rather than minting a bare separator', () => {
    expect(() => makeEntryId('orders', 'http', 'GET:/health', '')).toThrow(InvalidIdError);
  });

  it('upper-cases the method in an HTTP entry key', () => {
    expect(makeHttpEntryKey('post', 'orders/{id}')).toBe('POST:/orders/:param');
  });

  it('builds a channel id without a repo prefix', () => {
    expect(makeChannelId('order.created')).toBe('channel:order.created');
  });

  it('builds a type id', () => {
    expect(makeTypeId('orders', 'CreateOrderDto')).toBe('type:orders#CreateOrderDto');
  });

  it('rejects an empty or already prefixed channel name', () => {
    expect(() => makeChannelId('')).toThrow(InvalidChannelNameError);
    expect(() => makeChannelId('   ')).toThrow(InvalidChannelNameError);
    expect(() => makeChannelId('channel:order.created')).toThrow(InvalidChannelNameError);
  });

  it('rejects empty id parts', () => {
    expect(() => makeSymbolId('', 'a.ts', 'A')).toThrow(InvalidIdError);
    expect(() => makeTypeId('orders', '')).toThrow(InvalidIdError);
    expect(() => makeEntryId('orders', 'http', '')).toThrow(InvalidIdError);
  });
});

describe('workflows and references by name', () => {
  it('names a workflow entry by its deployed name and nothing else', () => {
    expect(makeEntryId('library', 'workflow', makeWorkflowEntryKey('loan-approval'))).toBe(
      'entry:library:workflow:loan-approval',
    );
  });

  it('names a step as a symbol of the file its workflow is written in', () => {
    expect(makeStateId('library', 'statemachine/loan.asl.json', 'loan-approval', 'CheckHolds')).toBe(
      'library#statemachine/loan.asl.json:loan-approval/CheckHolds',
    );
  });

  it('reads the reference an entry id answers to, with or without an application', () => {
    expect(entryReferenceOf('entry:library:workflow:loan-approval')).toBe('workflow:loan-approval');
    expect(entryReferenceOf('entry:loans@public:http:GET:/loans/:param')).toBe('http:GET:/loans/:param');
    expect(entryReferenceOf('library#a.ts:fn')).toBeUndefined();
  });

  it('spells a reference the way an entry id ends', () => {
    const reference = makeEntryReference('workflow', makeWorkflowEntryKey('loan-approval'));
    const id = makeEntryId('anywhere', 'workflow', makeWorkflowEntryKey('loan-approval'));
    expect(entryReferenceOf(id)).toBe(reference);
  });

  it('rejects an empty name', () => {
    expect(() => makeWorkflowEntryKey(' ')).toThrow(InvalidIdError);
    expect(() => makeStateId('library', 'a.asl.json', 'loan-approval', '')).toThrow(InvalidIdError);
  });
});

describe('normalizeFilePath with Windows paths (P83)', () => {
  it('climbs out of the repository for a path on the same drive', () => {
    expect(normalizeFilePath('C:/work/shop/packages/money/src/a.ts', 'C:/work/shop/services/orders')).toBe(
      '../../packages/money/src/a.ts',
    );
    expect(normalizeFilePath('C:\\work\\shop\\packages\\money\\src\\a.ts', 'C:\\work\\shop\\services\\orders')).toBe(
      '../../packages/money/src/a.ts',
    );
  });

  it('strips the repository from a path inside it, either spelling', () => {
    expect(normalizeFilePath('C:/work/shop/services/orders/src/a.ts', 'C:\\work\\shop\\services\\orders\\')).toBe('src/a.ts');
    expect(normalizeFilePath('C:/work/a.ts', 'C:/')).toBe('work/a.ts');
  });

  it('ignores the case of the drive letter', () => {
    expect(normalizeFilePath('c:/work/shop/services/orders/src/a.ts', 'C:/work/shop/services/orders')).toBe('src/a.ts');
    expect(normalizeFilePath('C:/work/shop/packages/money/a.ts', 'c:/work/shop/services/orders')).toBe(
      '../../packages/money/a.ts',
    );
  });

  it('leaves a path on another drive absolute, since no relative path leads there', () => {
    expect(normalizeFilePath('D:/cache/money/a.ts', 'C:/work/shop/services/orders')).toBe('D:/cache/money/a.ts');
    expect(normalizeFilePath('D:/cache/money/a.ts', '/work/shop/services/orders')).toBe('D:/cache/money/a.ts');
    expect(normalizeFilePath('/work/shop/a.ts', 'C:/work/shop/services/orders')).toBe('/work/shop/a.ts');
  });
});

describe('a path inside a directory, spelled either way (P199)', () => {
  // The compiler names a file `C:/work/...` on Windows; `path.join` names its
  // directory `C:\work\...`. Each pair below is one place spelled two ways.
  it('is inside its directory whichever separator either side uses', () => {
    expect(isWithinDir('C:/work/shop/packages/lib/src/a.ts', 'C:\\work\\shop\\packages\\lib')).toBe(true);
    expect(isWithinDir('C:\\work\\shop\\packages\\lib\\src\\a.ts', 'C:/work/shop/packages/lib/')).toBe(true);
    expect(isBelowDir('c:/work/shop/packages/lib/src/a.ts', 'C:\\work\\shop\\packages\\lib')).toBe(true);
    expect(isBelowDir('/work/shop/packages/lib/src/a.ts', '/work/shop/packages/lib')).toBe(true);
  });

  it('tells the directory itself from what is below it', () => {
    expect(isWithinDir('C:\\work\\shop', 'C:/work/shop')).toBe(true);
    expect(isBelowDir('C:\\work\\shop', 'C:/work/shop/')).toBe(false);
    expect(isBelowDir('/work/shop', '/work/shop')).toBe(false);
  });

  it('is not inside a directory it only begins like, or one on another drive', () => {
    expect(isWithinDir('C:\\work\\shop-extra\\a.ts', 'C:/work/shop')).toBe(false);
    expect(isWithinDir('D:/work/shop/a.ts', 'C:\\work\\shop')).toBe(false);
    expect(isBelowDir('/work/shop-extra/a.ts', '/work/shop')).toBe(false);
  });

  it('is inside the root of a drive or of the file system', () => {
    expect(isBelowDir('C:\\work\\a.ts', 'C:\\')).toBe(true);
    expect(isBelowDir('/work/a.ts', '/')).toBe(true);
  });

  it('finds the package of a file under node_modules, either spelling', () => {
    expect(packageOfPath('C:\\work\\shop\\node_modules\\@acme\\money\\index.d.ts')).toBe('@acme/money');
    expect(packageOfPath('C:/work/shop/node_modules/left-pad/index.d.ts')).toBe('left-pad');
    expect(isExternalFile('C:\\work\\shop\\node_modules\\left-pad\\index.d.ts')).toBe(true);
    expect(isExternalFile('C:\\work\\shop\\src\\main.ts')).toBe(false);
  });
});
