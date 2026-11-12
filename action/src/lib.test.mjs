import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canComment, checkoutPlan, cloneOf, docsCheck, docsNote, exitOf, markerOf, nothingChanged, outputLines, parseRepositories, saysSomething, upsertComment, versionOf } from './lib.mjs';

/** Who comments with the job's own token. */
const ACTIONS = { login: 'github-actions[bot]', type: 'Bot' };

/**
 * A GitHub REST API in memory: the calls it was asked, and one pull request's
 * comments. With `login` the token is a person's, which `GET /user` names;
 * without, it is the job's own, which `GET /user` refuses, and it posts as a bot.
 */
const fakeGitHub = (comments = [], { fail, login } = {}) => {
  const calls = [];
  let next = 1000;
  const fetchImpl = async (url, init) => {
    const path = url.replace('https://api.github.com', '');
    calls.push(`${init.method} ${path}`);
    if (fail !== undefined) return { ok: false, status: fail };
    if (path === '/user') return login === undefined ? { ok: false, status: 403 } : { ok: true, status: 200, json: async () => ({ login }) };
    if (init.method === 'GET') {
      const page = Number(/[?&]page=(\d+)/.exec(path)[1]);
      return { ok: true, status: 200, json: async () => comments.slice((page - 1) * 100, page * 100) };
    }
    const body = JSON.parse(init.body).body;
    if (init.method === 'PATCH') {
      const id = Number(/comments\/(\d+)$/.exec(path)[1]);
      const comment = comments.find((item) => item.id === id);
      comment.body = body;
      return { ok: true, status: 200, json: async () => ({ ...comment, html_url: `https://github.test/c/${id}` }) };
    }
    const created = { id: (next += 1), user: login === undefined ? ACTIONS : { login, type: 'User' }, body };
    comments.push(created);
    return { ok: true, status: 201, json: async () => ({ ...created, html_url: `https://github.test/c/${created.id}` }) };
  };
  return { calls, comments, fetchImpl };
};

const MARK = '<!-- flowatlas:diff config=cf4bf246 -->';
const OTHER = '<!-- flowatlas:diff config=0000beef -->';
const bodyOf = (text) => `${MARK}\n${text}\n`;

describe('one comment per configuration per pull request (P231)', () => {
  it('posts the first time, and updates that one comment on every push after', async () => {
    const github = fakeGitHub([{ id: 1, body: 'looks good to me' }]);
    const args = { fetchImpl: github.fetchImpl, token: 't', repo: 'acme/shop', pr: 7 };
    assert.deepEqual(await upsertComment({ ...args, body: bodyOf('first') }), { action: 'created', url: 'https://github.test/c/1001' });
    assert.deepEqual(await upsertComment({ ...args, body: bodyOf('second') }), { action: 'updated', url: 'https://github.test/c/1001' });
    assert.equal(github.comments.length, 2);
    assert.equal(github.comments[1].body, bodyOf('second'));
    assert.deepEqual(github.calls, [
      'GET /user',
      'GET /repos/acme/shop/issues/7/comments?per_page=100&page=1',
      'POST /repos/acme/shop/issues/7/comments',
      'GET /user',
      'GET /repos/acme/shop/issues/7/comments?per_page=100&page=1',
      'PATCH /repos/acme/shop/issues/comments/1001',
    ]);
  });

  it('keeps two configurations’ comments apart, and finds one past the first page', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: i + 1, body: `note ${i}` }));
    many.push({ id: 999, user: ACTIONS, body: `${OTHER}\nthe other project` });
    many.push({ id: 998, user: ACTIONS, body: bodyOf('ours') });
    const github = fakeGitHub(many);
    const done = await upsertComment({ fetchImpl: github.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: bodyOf('new') });
    assert.equal(done.action, 'updated');
    assert.equal(many.find((item) => item.id === 999).body, `${OTHER}\nthe other project`);
    assert.equal(many.find((item) => item.id === 998).body, bodyOf('new'));
  });

  it('posts a new comment every time with comment: new', async () => {
    const github = fakeGitHub([{ id: 5, body: bodyOf('old') }]);
    assert.equal((await upsertComment({ fetchImpl: github.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: bodyOf('x'), mode: 'new' })).action, 'created');
    assert.equal(github.comments.length, 2);
  });

  it('with nothing to say, updates a comment already there and posts none', async () => {
    const none = fakeGitHub([]);
    assert.deepEqual(await upsertComment({ fetchImpl: none.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: nothingChanged(MARK, 'abc'), quiet: true }), { action: 'none' });
    assert.equal(none.comments.length, 0);
    const there = fakeGitHub([{ id: 3, user: ACTIONS, body: bodyOf('before') }]);
    assert.equal((await upsertComment({ fetchImpl: there.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: nothingChanged(MARK, 'abcdef0123456789'), quiet: true })).action, 'updated');
    assert.equal(there.comments[0].body, `${MARK}\nNo flow, contract or rule changes since \`abcdef012345\`.\n`);
  });

  it('updates only its own comment, never one somebody else wrote with the marker in it', async () => {
    // The marker is computable from the configuration, so anyone can paste it.
    const forged = { id: 11, user: { login: 'mallory', type: 'User' }, body: bodyOf('All clear, merge it.') };
    const github = fakeGitHub([forged, { id: 12, user: ACTIONS, body: bodyOf('the report') }]);
    const done = await upsertComment({ fetchImpl: github.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: bodyOf('new report') });
    assert.equal(done.action, 'updated');
    assert.deepEqual(github.calls.slice(-1), ['PATCH /repos/a/b/issues/comments/12']);
    assert.equal(forged.body, bodyOf('All clear, merge it.'));
    // Only a forged one there: a comment of its own is posted, and with nothing to say none is.
    const alone = fakeGitHub([{ ...forged }]);
    assert.equal((await upsertComment({ fetchImpl: alone.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: nothingChanged(MARK, 'abc'), quiet: true })).action, 'none');
    assert.equal((await upsertComment({ fetchImpl: alone.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: bodyOf('x') })).action, 'created');
    assert.equal(alone.comments[0].body, bodyOf('All clear, merge it.'));
  });

  it('with a person\'s token, updates that person\'s comment and no bot\'s', async () => {
    const github = fakeGitHub([{ id: 21, user: ACTIONS, body: bodyOf('a bot') }, { id: 22, user: { login: 'ci-user', type: 'User' }, body: bodyOf('ours') }], { login: 'ci-user' });
    await upsertComment({ fetchImpl: github.fetchImpl, token: 't', repo: 'a/b', pr: 1, body: bodyOf('new') });
    assert.deepEqual(github.calls, ['GET /user', 'GET /repos/a/b/issues/1/comments?per_page=100&page=1', 'PATCH /repos/a/b/issues/comments/22']);
    assert.equal(github.comments[0].body, bodyOf('a bot'));
  });

  it('refuses a body flowatlas did not write, and says the status of a refused call', async () => {
    await assert.rejects(upsertComment({ fetchImpl: fakeGitHub().fetchImpl, token: 't', repo: 'a/b', pr: 1, body: 'hello' }), /no flowatlas marker/);
    await assert.rejects(upsertComment({ fetchImpl: fakeGitHub([], { fail: 403 }).fetchImpl, token: 't', repo: 'a/b', pr: 1, body: bodyOf('x') }), /403/);
  });
});

describe('what the action reads and decides', () => {
  it('reads repositories, one a line, with an optional ref', () => {
    assert.deepEqual(parseRepositories('orders=acme/orders@main\n\n# billing is ours too\nbilling = acme/billing\n'), [
      { name: 'orders', repo: 'acme/orders', ref: 'main' },
      { name: 'billing', repo: 'acme/billing' },
    ]);
    assert.throws(() => parseRepositories('orders acme/orders'), /line 1/);
  });

  it('fetches only the services not checked out and named, and says the rest', () => {
    const plan = checkoutPlan(
      [
        { name: 'web', dir: '/w/web' },
        { name: 'orders', dir: '/w/orders' },
        { name: 'billing', dir: '/w/billing' },
      ],
      [{ name: 'orders', repo: 'acme/orders' }, { name: 'payments', repo: 'acme/payments' }],
      (dir) => dir === '/w/web',
    );
    assert.deepEqual(plan, { fetch: [{ name: 'orders', repo: 'acme/orders', dir: '/w/orders' }], missing: ['billing'], unknown: ['payments'] });
  });

  it('installs the version the action was released with, unless told', () => {
    assert.equal(versionOf('', 'v0.7.0'), '0.7.0');
    assert.equal(versionOf('', 'main'), 'latest');
    assert.equal(versionOf('0.6.0', 'v0.7.0'), '0.6.0');
  });

  it('comments only from this repository, never from a fork', () => {
    assert.equal(canComment({ pull_request: { head: { repo: { full_name: 'acme/shop' } } } }, 'acme/shop'), true);
    assert.equal(canComment({ pull_request: { head: { repo: { full_name: 'someone/shop' } } } }, 'acme/shop'), false);
    assert.equal(canComment({}, 'acme/shop'), false);
    // A fork deleted since the pull request was opened: still a fork's pull request.
    assert.equal(canComment({ pull_request: { head: { repo: null } } }, 'acme/shop'), false);
  });

  it('says something when anything was reached or broken, and writes the outputs', () => {
    const facts = { reaches: { entries: 0, services: 0 }, contractBreaks: 0, ruleBreaks: 0, staleDocs: 0, verdict: 'safe' };
    assert.equal(saysSomething(facts), false);
    assert.equal(saysSomething({ ...facts, staleDocs: 1 }), true);
    assert.equal(markerOf(`${MARK}\nx`), MARK);
    assert.equal(outputLines(facts, undefined), 'verdict=safe\nreaches=0\ncontract-breaks=0\nrule-breaks=0\nstale-docs=0\ncomment-url=');
  });
});

describe('cloning the other repositories (P231)', () => {
  it('keeps the token out of the address, so the clone\'s .git/config never holds it', () => {
    const clone = cloneOf({ repo: 'acme/orders', ref: 'main', dir: '/w/orders' }, 'ghs_secret', {});
    assert.deepEqual(clone.args, ['clone', '--quiet', '--depth=1', '--branch', 'main', 'https://github.com/acme/orders.git', '/w/orders']);
    assert.equal(clone.args.join(' ').includes('ghs_secret'), false);
    assert.equal(clone.secret, Buffer.from('x-access-token:ghs_secret').toString('base64'));
    assert.deepEqual(clone.env, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${clone.secret}`,
    });
  });

  it('adds to configuration the runner already hands git, and sends no header without a token', () => {
    assert.equal(cloneOf({ repo: 'a/b', dir: '/w/b' }, 't', { GIT_CONFIG_COUNT: '2' }).env.GIT_CONFIG_KEY_2, 'http.https://github.com/.extraheader');
    assert.deepEqual(cloneOf({ repo: 'a/b', dir: '/w/b' }, '', {}), { args: ['clone', '--quiet', '--depth=1', 'https://github.com/a/b.git', '/w/b'], env: {} });
  });
});

describe('the docs check (P231)', () => {
  const runs = (exit) => {
    const asked = [];
    return { asked, run: (args) => (asked.push(args), exit) };
  };

  it('reads the head graph diff kept, not a graph.db a pull request never builds', () => {
    const fake = runs(0);
    assert.deepEqual(docsCheck({ wanted: true, configPath: '/w/flowatlas.config.json', headDb: '/w/.flowatlas/pull-request-graph.db', run: fake.run, exists: () => true }), {});
    assert.deepEqual(fake.asked, [['docs', '--check', '--config', '/w/flowatlas.config.json', '--db', '/w/.flowatlas/pull-request-graph.db', '--format', 'github']]);
  });

  it('says in the comment when it cannot run, with no graph or a marker it cannot read, and never fails for it', () => {
    const args = { wanted: true, configPath: 'c', headDb: 'h' };
    // Stale blocks are its annotations; exit 1 is not a reason to say anything more.
    assert.deepEqual(docsCheck({ ...args, run: runs(1).run, exists: () => true }), {});
    const missing = runs(0);
    const skipped = docsCheck({ ...args, run: missing.run, exists: () => false });
    assert.match(skipped.skipped, /no head graph/);
    assert.deepEqual(missing.asked, []);
    assert.match(docsCheck({ ...args, run: runs(2).run, exists: () => true }).skipped, /could not run/);
    assert.match(docsNote(skipped.skipped), /^\n> \*\*The docs check did not run:\*\* /);
    assert.deepEqual(docsCheck({ ...args, wanted: false, run: missing.run }), {});
  });

  it('fails the pull request on docs only when told to, and then on the ones the branch made stale', () => {
    const facts = { staleDocs: 2 };
    assert.equal(exitOf(0, facts, new Set(['contract-break', 'rule-break'])), 0);
    assert.equal(exitOf(0, facts, new Set(['stale-docs'])), 1);
    assert.equal(exitOf(0, { staleDocs: 0 }, new Set(['stale-docs'])), 0);
    assert.equal(exitOf(1, { staleDocs: 0 }, new Set()), 1);
  });
});
