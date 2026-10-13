#!/usr/bin/env node
/**
 * Measure this tool against real repositories, repeatably.
 *
 *   node scripts/coverage/run.mjs                 # every target, fresh clones
 *   node scripts/coverage/run.mjs --target <name> # one of them
 *   node scripts/coverage/run.mjs --install       # with dependencies installed
 *   node scripts/coverage/run.mjs --render        # re-write reports from the cache
 *   node scripts/coverage/run.mjs --pin           # re-pin the list to today
 *
 * This is not part of `pnpm check`. It clones the internet and takes minutes.
 * It is run deliberately - before a release, and after any change to a reader -
 * and it writes one report per target per state into `scripts/coverage/reports`,
 * written so that two runs compare as a diff somebody can read rather than as a
 * claim somebody has to believe. The targets and the reports stay local: they
 * name other people's repositories, which this project does not.
 *
 * ## Both states are real, and they are different questions
 *
 * A fresh clone is what a stranger gets: no `node_modules`, so the checker
 * resolves almost nothing outside the repository. With dependencies installed
 * the checker can follow a type into a package, and the answers differ a great
 * deal. Neither is the honest one on its own, so both are recordable and each
 * gets its own file.
 *
 * Dependencies are installed with `--ignore-scripts`. Running eight strangers'
 * postinstall hooks on this machine is not something a coverage report is worth,
 * and what the reader needs from an install is resolvable types rather than
 * generated artefacts. Where that costs a number - a generated Prisma client
 * that is therefore not there - the report says so rather than quietly counting
 * it as a limit of the tool.
 *
 * An install that *fails* is not one of those costs and is never written down as
 * a measurement: `--install` refuses that target rather than answering it, or the
 * file would carry fresh-clone figures under an installed heading. `install`
 * below says which two ways that has already happened.
 *
 * ## It measures the tool in the tree, or it refuses
 *
 * A fix that looks like it did nothing is the one failure a coverage harness must
 * never produce, and it produced it twice on the day it was first used in
 * earnest. The cause is that this command runs a **bundle**: a reader edited and
 * not rebuilt is not in it, and the measurement that follows is a correct
 * measurement of yesterday's code. Nothing along the way is broken and nothing
 * says so. So a run whose sources are newer than the build is refused rather than
 * answered, and the state each measurement starts from - the workspace, and every
 * `.flowatlas` a previous run left in the clone - is established rather than
 * assumed.
 *
 * ## The gate over what was not read
 *
 * Every measurement is also an assertion: a file the counting rule found sites in
 * must yield a node of that family, or a row naming it. A reader that gave up in
 * silence fails the run. `read-gate.mjs` holds the assertion, its exemptions, and
 * what it deliberately cannot see.
 *
 * ## Failing is data
 *
 * A target whose build crashes or runs out of heap is recorded with its exit
 * code and the last of its output, as an outcome of the measurement. It is not
 * a harness error and it is never skipped: a tool that dies on a real
 * repository is the single most important thing a coverage report can say, and
 * a harness that hid it behind a stack trace of its own would be worse than no
 * harness.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byFamily, isSourceFile, measureSites } from './counting-rule.mjs';
import { extentOfTarget } from './extent.mjs';
import { figuresFrom } from './figures.mjs';
import { clonePaths, readGate } from './read-gate.mjs';
import { renderReport } from './report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');
/**
 * The repositories to measure, kept out of version control.
 *
 * They are other people's repositories, so this project does not name them:
 * the list, with each target's exemptions and baseline, lives in a local file
 * that is gitignored, and `targets.example.json` shows its shape.
 */
const TARGETS = join(ROOT, 'scripts', 'coverage', 'targets.local.json');
const TARGETS_EXAMPLE = join(ROOT, 'scripts', 'coverage', 'targets.example.json');
const REPORTS = join(ROOT, 'scripts', 'coverage', 'reports');

/**
 * Where clones live.
 *
 * Under the checkout and gitignored rather than in the system temporary
 * directory, so a second run costs a fetch of nothing instead of another five
 * gigabytes over the network, and so deleting it is one obvious command. It is
 * safe to delete at any time: everything in it is derived from `targets.json`.
 */
const CACHE = join(ROOT, '.coverage-cache');

/**
 * The directory the tool writes into, spelled here rather than imported.
 *
 * One string is a smaller debt than a harness that cannot measure a tool it
 * cannot import. Everything else in this directory is independent of the
 * package it measures and this is the one fact it has to know; if it ever
 * changes, every report in this directory becomes a report of a stale cache,
 * which is the failure this constant exists to prevent.
 */
const OUTPUT = '.flowatlas';

// ---------------------------------------------------------------- processes

/**
 * Peak resident memory, by platform, or nothing where it cannot be had.
 *
 * Node can report its own resource usage and not a child's, and the child is
 * the whole point, so this goes through `time`. The figure is coarse - it is
 * the high-water mark of the whole process tree, including the shell that
 * wrapped it - and coarse is worth having: this tool has been measured at 1.39
 * GB and has died at four, and no finer instrument is needed to tell those
 * apart.
 */
const PEAK_MEMORY = {
  darwin: {
    argv: ['/usr/bin/time', '-l'],
    read: (text) => /^\s*(\d+)\s+maximum resident set size/m.exec(text)?.[1],
  },
  linux: {
    argv: ['/usr/bin/time', '-v'],
    read: (text) => {
      const kb = /Maximum resident set size \(kbytes\): (\d+)/.exec(text)?.[1];
      return kb === undefined ? undefined : String(Number(kb) * 1024);
    },
  },
};

const timer = PEAK_MEMORY[process.platform];

/**
 * Run a command and report how it ended, never throwing on a bad exit.
 *
 * Everything this harness runs is allowed to fail, and a failure is a result
 * rather than an exception, so the shape that comes back is the same either
 * way and the caller decides what a non-zero code means.
 */
const run = (argv, { cwd, timeoutMs = 20 * 60 * 1000, env = {} }) =>
  new Promise((done) => {
    const wrapped = timer === undefined ? argv : [...timer.argv, ...argv];
    const started = process.hrtime.bigint();
    const child = spawn(wrapped[0], wrapped.slice(1), {
      cwd,
      detached: true,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    // Killing the group rather than the child: `time` forks, and killing the
    // wrapper alone would leave a build running and the cache half written.
    const alarm = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(alarm);
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      const peak = timer?.read(err);
      done({
        code,
        signal,
        seconds,
        peakBytes: peak === undefined ? null : Number(peak),
        stdout: out,
        stderr: err,
      });
    });
  });

/**
 * The last few lines of whatever a failure said, with the timer's own output
 * taken off the end.
 *
 * `time` appends its report to the child's standard error, so the last lines of
 * that stream are a page of resource counters rather than the message anybody
 * wants. Cutting from the line where the timer starts leaves what the tool
 * actually said, which on a target that crashes is the entire result.
 */
const withoutTiming = (text) => {
  const lines = text.split('\n');
  const start = lines.findLastIndex((line) => /^\s*[\d.]+\s+real\s/.test(line));
  return (start === -1 ? lines : lines.slice(0, start)).join('\n');
};

/**
 * Why a run did not finish, in the tool's own words.
 *
 * A repository the build could not read says so on one line naming itself and
 * the reason, and that line is the whole content of two of these eight reports.
 * It is preferred over the last few lines of output because it is the answer,
 * and the last few lines of a build that kept going are a summary of the
 * nothing it produced.
 */
const SAYS_WHY = [
  // A repository the build could not read, and the reason it gives.
  /\bskipped \(/,
  // The one reason that does not survive being quoted back: a reader that ran
  // out of heap dies inside a child process, and the line that says so is
  // thirty frames above the tail of the stack trace the parent repeats. Without
  // this, a CMS monorepo's report carried three addresses in a dynamic library and not
  // the words "heap out of memory".
  /FATAL ERROR|out of memory|Allocation failed/i,
];

const whyFailed = (text) => {
  const said = withoutTiming(text)
    .split('\n')
    .filter((line) => SAYS_WHY.some((pattern) => pattern.test(line)))
    .map((line) => line.trim().slice(0, 400));
  return [...new Set(said)].join('\n');
};

const tail = (text, lines = 6) =>
  withoutTiming(text)
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-lines)
    .join('\n')
    .trim();

// ------------------------------------------------------------------ cloning

/**
 * A shallow clone of one commit, or the clone that is already there.
 *
 * Fetching the pinned object directly rather than cloning a branch and walking
 * back to it: it is one round trip, it costs one commit of history, and it
 * cannot drift the way `clone --depth 1` of a moving branch does.
 */
const clone = async (target, log) => {
  const dir = join(CACHE, 'repos', target.name);
  const url = `https://github.com/${target.repository}.git`;
  if (existsSync(join(dir, '.git'))) {
    const head = await run(['git', 'rev-parse', 'HEAD'], { cwd: dir });
    if (head.stdout.trim() === target.commit) return dir;
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  log(`cloning ${target.repository} at ${target.commit.slice(0, 12)}`);
  await run(['git', 'init', '-q'], { cwd: dir });
  await run(['git', 'remote', 'add', 'origin', url], { cwd: dir });
  const fetched = await run(['git', 'fetch', '-q', '--depth', '1', 'origin', target.commit], {
    cwd: dir,
    timeoutMs: 30 * 60 * 1000,
  });
  if (fetched.code !== 0) throw new Error(`fetch failed for ${target.name}: ${tail(fetched.stderr)}`);
  const out = await run(['git', 'checkout', '-q', 'FETCH_HEAD'], { cwd: dir });
  if (out.code !== 0) throw new Error(`checkout failed for ${target.name}: ${tail(out.stderr)}`);
  return dir;
};

/**
 * Put a clone back to exactly what the fetch produced.
 *
 * A fresh-clone measurement run after an installed one would otherwise read a
 * `node_modules` left behind by the install and quietly report the wrong state,
 * which is the one mistake that would make both reports untrustworthy at once.
 * So the fresh state is established rather than assumed, every time, and costs
 * one `git clean` on a clone that was already clean.
 */
const freshen = async (dir) => {
  await run(['git', 'clean', '-xdff', '-q'], { cwd: dir, timeoutMs: 10 * 60 * 1000 });
  await run(['git', 'checkout', '-q', '--', '.'], { cwd: dir });
};

/** Today's commit on the default branch, for `--pin`. */
const headOf = async (target) => {
  const url = `https://github.com/${target.repository}.git`;
  const out = await run(['git', 'ls-remote', url, 'HEAD'], { cwd: ROOT });
  if (out.code !== 0) throw new Error(`could not reach ${target.repository}`);
  return out.stdout.trim().split(/\s+/)[0];
};

// --------------------------------------------------------------- installing

/**
 * How to install, chosen by the lockfile that is there.
 *
 * A lookup rather than a chain of conditions, and the order is the order of
 * specificity: a repository carrying two lockfiles is being built with the
 * first of these its authors wrote down.
 */
const INSTALLERS = [
  {
    name: 'pnpm',
    lockfile: 'pnpm-lock.yaml',
    argv: ['pnpm', 'install', '--ignore-scripts', '--no-frozen-lockfile'],
  },
  {
    name: 'yarn-berry',
    lockfile: 'yarn.lock',
    // Yarn 2 and later have no `--ignore-scripts`; the same thing is spelled
    // `--mode=skip-build`, and passing the old flag is a syntax error that ends
    // the install in a sixth of a second. It did, on a wiki app, and the report
    // dutifully recorded a repository with no dependencies as a repository with
    // dependencies installed. A version of Yarn is not a fact about a wiki app, so
    // it is detected rather than written down beside the target.
    beside: '.yarnrc.yml',
    argv: ['yarn', 'install', '--mode=skip-build'],
  },
  { name: 'yarn', lockfile: 'yarn.lock', argv: ['yarn', 'install', '--ignore-scripts'] },
  {
    name: 'npm',
    lockfile: 'package-lock.json',
    argv: ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'],
  },
  { name: 'bun', lockfile: 'bun.lockb', argv: ['bun', 'install', '--ignore-scripts'] },
];

/**
 * Where a dependency install has to happen for a directory to be readable.
 *
 * The directory being read first, then the root of the clone: a service inside
 * a workspace has no lockfile of its own and is installed by the workspace, and
 * a repository that is its own root has both answers in one place.
 */
const installPlan = (cloneDir, readRoot) => {
  for (const dir of [join(cloneDir, readRoot), cloneDir]) {
    for (const installer of INSTALLERS) {
      const fits =
        existsSync(join(dir, installer.lockfile)) &&
        (installer.beside === undefined || existsSync(join(dir, installer.beside)));
      if (fits) return { dir, ...installer };
    }
  }
  return undefined;
};

const install = async (cloneDir, target, log) => {
  const plans = [];
  const seen = new Set();
  for (const readRoot of target.read) {
    const plan = installPlan(cloneDir, readRoot);
    if (plan === undefined || seen.has(plan.dir)) continue;
    seen.add(plan.dir);
    plans.push(plan);
  }
  const results = [];
  for (const plan of plans) {
    log(`installing ${relative(cloneDir, plan.dir) || '.'} with ${plan.name}`);
    const out = await run(plan.argv, {
      cwd: plan.dir,
      timeoutMs: 45 * 60 * 1000,
      env: {
        // Corepack would otherwise stop to ask about a package manager the
        // repository pins, and a prompt in a harness is a hang.
        COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
        // The second half of not running anybody's postinstall hooks: Yarn
        // reads this, and it costs nothing on a manager that does not.
        YARN_ENABLE_SCRIPTS: '0',
        CI: '1',
        ADBLOCK: '1',
        HUSKY: '0',
      },
    });
    results.push({
      where: relative(cloneDir, plan.dir) || '.',
      manager: plan.name,
      lockfile: plan.lockfile,
      code: out.code,
      seconds: out.seconds,
      note: out.code === 0 ? null : tail(out.stderr, 4) || tail(out.stdout, 4) || 'no message',
    });
  }
  // An install that did not install is not a with-deps measurement.
  //
  // `--install` asks a different question from a fresh clone, and the answer is
  // only worth writing down if the state it names was established. A non-zero
  // install leaves a tree with no `node_modules` and a report whose heading says
  // the opposite - every figure in it a fresh-clone figure filed as an installed
  // one. That has now happened twice: once because Yarn 2 rejects
  // `--ignore-scripts` and ended the install in a sixth of a second, and once
  // because `yarn` was not on the machine at all and exited 127 in less than
  // that, while the run printed `installing . with yarn-berry`, wrote the
  // report, and removed the notice saying the file had not been measured here.
  // So the target is refused the way a failed clone is: no report is
  // overwritten, the run exits non-zero, and the message names the manager and
  // what it said.
  //
  // A crashed *build* is the opposite case and stays a measured outcome: a tool
  // that dies on a real repository is the most important thing a coverage report
  // can say. The difference is whose failure it is - the build is what is being
  // measured, and the install is only the state it is measured in.
  const broken = results.filter((result) => result.code !== 0);
  if (broken.length > 0) {
    const said = broken
      .map(({ where, manager, code, note }) => `${where} with ${manager} exited ${code}: ${note}`)
      .join('; ');
    throw new Error(`dependencies were not installed, so there is nothing to measure. ${said}`);
  }
  return results;
};

// -------------------------------------------------------------- ground truth

/**
 * Ground truth for one target, by the one rule in `counting-rule.mjs`, counted
 * over the extent the rule works out in `extent.mjs`.
 *
 * The extent is the correction to a fraction that had stopped being one. A
 * service is an application together with the workspace packages it declares, so
 * the tool's figures reach into those packages; the rule counted the read
 * directory alone and a scheduling app came out at `444 of 80`. A ratio above one is two
 * questions divided by each other. Both halves now ask about the same files.
 *
 * The file list comes from git rather than from a directory walk, so an
 * installed `node_modules` and a build directory left over from an earlier
 * state are invisible and the denominator is the same in both states. That is
 * what makes the two reports comparable to each other as well as to the tool.
 */
const groundTruth = async (cloneDir, readRoots) => {
  const extent = extentOfTarget(cloneDir, readRoots);
  const listed = await run(['git', 'ls-files', '-z', '--', ...extent.dirs], { cwd: cloneDir });
  const paths = listed.stdout.split('\0').filter((path) => path !== '' && isSourceFile(path));
  const files = [];
  for (const path of paths) {
    try {
      files.push([path, readFileSync(join(cloneDir, path), 'utf8')]);
    } catch {
      // A file git tracks and the filesystem will not give us is not a
      // declaration site anybody can read either.
    }
  }
  const { byProbe, perFile } = measureSites(files);
  return {
    truth: {
      files: paths.length,
      sites: byProbe,
      families: byFamily(byProbe),
      extent: extent.perRoot.map(({ readRoot, root, dirs }) => ({
        readRoot,
        workspace: root,
        declared: dirs.slice(1),
      })),
    },
    perFile,
  };
};

/**
 * Everything a previous run of this target left where the tool will look.
 *
 * Up to R166 a service kept its graph and its build cache in `.flowatlas`
 * **inside the repository it read**; it now keeps them in the workspace, under
 * `services/`, and the repository is only cleared of what an older build left
 * there. The harness used to remove only its own workspace. On
 * a fresh run the clean that establishes the fresh state took the rest away as a
 * side effect; under `--install` there is no clean, so both survived from run to
 * run.
 *
 * What this is *not* is the thing that made two "after" measurements come back
 * byte-identical to the baseline. That was measured rather than assumed, because
 * assuming it is how it got written down wrong the first time: with a whole stale
 * `.flowatlas` deliberately left in the clone and a reader changed, the figure
 * moved anyway - the cache records which extractors built it and throws itself
 * away when one of them changes. The real mechanism was a stale **bundle**, and
 * it is refused by `refuseIfStale` below.
 *
 * This is kept anyway, because a build is allowed to keep the graph it already
 * has when an extraction fails, which is the one path that can serve an old
 * answer for a real reason, and because a state established costs one `rm` while
 * a state assumed costs a report nobody can trust. It clears the extent and not
 * only the read root, since a declared package is somewhere a build may write.
 */
const forget = (cloneDir, readRoots, workspace) => {
  rmSync(workspace, { recursive: true, force: true });
  const { dirs } = extentOfTarget(cloneDir, readRoots);
  for (const dir of ['.', ...dirs, ...readRoots]) {
    rmSync(join(cloneDir, dir, OUTPUT), { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------- measuring

const flowatlas = (args, cwd, timeoutMs) => run([process.execPath, CLI, ...args], { cwd, timeoutMs });

/**
 * Apply the target's declared types over the ones `link` guessed.
 *
 * What `link` guessed is kept beside what was set, and both go in the report.
 * That matters: a wiki app declares Koa and React in one manifest, `link` answers
 * `react` because React is the more common of the two, and the whole Koa half
 * of the repository then reads as a repository with no routes. Overwriting the
 * type quietly would hide that; printing both says what a stranger gets and
 * what one line of configuration buys, which are the two facts worth having.
 */
const configure = (config, target, cloneDir) => {
  const parsed = JSON.parse(readFileSync(config, 'utf8'));
  const declared = target.types ?? {};
  const services = parsed.services.map((service) => {
    const readRoot = target.read.find(
      (path) => resolve(dirname(config), service.repo) === resolve(join(cloneDir, path)),
    );
    const type = (readRoot === undefined ? undefined : declared[readRoot]) ?? service.type;
    return { ...service, type };
  });
  writeFileSync(config, `${JSON.stringify({ ...parsed, services }, null, 2)}\n`, 'utf8');
  return parsed.services.map((service, index) => ({
    name: service.name,
    // Clone-relative, because the gate has to turn a path the graph spells
    // relative to a service into a path the counting rule spells relative to the
    // clone, and the service is the only thing that knows the difference.
    repo: relative(cloneDir, resolve(dirname(config), service.repo)).split('\\').join('/') || '.',
    guessed: service.type,
    type: services[index].type,
  }));
};

/**
 * One whole measurement: link, build, doctor, and read what they left.
 *
 * The workspace holding the configuration sits beside the clone rather than in
 * it, so nothing the harness does can show up in the file list the counting
 * rule reads.
 */
const measure = async (target, cloneDir, state, log, timeoutMs) => {
  const workspace = join(CACHE, 'work', `${target.name}.${state}`);
  forget(cloneDir, target.read, workspace);
  mkdirSync(workspace, { recursive: true });
  const config = join(workspace, 'flowatlas.config.json');
  const roots = target.read.map((readRoot) => join(cloneDir, readRoot));

  const linked = await flowatlas(['link', ...roots, '--config', config, '--no-mcp'], workspace, timeoutMs);
  log(`link exit ${linked.code}`);
  const services = existsSync(config) ? configure(config, target, cloneDir) : [];
  for (const service of services) {
    if (service.guessed !== service.type) log(`${service.name}: ${service.guessed} -> ${service.type}`);
  }

  // Without `--json`, because the figures are read from the artefacts anyway
  // and the summary is where a repository that could not be read says why. Under
  // `--json` that sentence is not printed at all, and a notification service's crash - the one
  // thing its report exists to carry - arrived as an empty message.
  const built = await flowatlas(['build', '--config', config], workspace, timeoutMs);
  log(`build exit ${built.code}${built.signal ? ` (${built.signal})` : ''} in ${built.seconds.toFixed(1)} s`);
  const doctored = await flowatlas(
    ['doctor', '--config', config, '--format', 'json', '--no-baseline'],
    workspace,
    timeoutMs,
  );
  log(`doctor exit ${doctored.code}`);

  const artefact = (name) => {
    const path = join(workspace, OUTPUT, name);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  };
  const graph = artefact('project-graph.json');
  const report = artefact('link-report.json');
  const doctor = artefact('doctor.json');

  return {
    workspace,
    services,
    steps: {
      link: { code: linked.code, signal: linked.signal },
      build: {
        code: built.code,
        signal: built.signal,
        seconds: built.seconds,
        peakBytes: built.peakBytes,
        message:
          built.code === 0
            ? null
            : whyFailed(built.stderr) ||
              whyFailed(built.stdout) ||
              tail(built.stderr) ||
              tail(built.stdout) ||
              null,
      },
      doctor: { code: doctored.code, signal: doctored.signal },
    },
    figures:
      graph === undefined || report === undefined
        ? undefined
        : figuresFrom({ graph, report, doctor }),
    // Handed back rather than kept: the gate needs it and no report does, and a
    // hundred megabytes of graph in `measured.json` would cost every re-render a
    // parse of it.
    graph,
  };
};

/**
 * The gate over what was not read, applied to one measured target (R111).
 *
 * The translation between the two spellings of a path lives here because this is
 * where both are in hand: the counting rule names a file relative to the clone
 * and the graph names it relative to the service that read it, which for a
 * declared package is `../../packages/lib/…`. A service that is not in the list
 * is a service the harness did not configure, and a node of one is not evidence
 * about a file the rule counted: `clonePaths` places it nowhere and the gate
 * says how many it could not place.
 */
const gate = (target, state, services, perFile, graph) => {
  if (graph === undefined) return undefined;
  const toPath = clonePaths(services);
  // The state goes in because the baseline is keyed on it: a wiki app is 45 files
  // unread on a fresh clone and none with its dependencies installed, and one
  // number covering both would be stale in whichever of the two it was not
  // measured in (R124).
  return readGate({
    where: target.name,
    state,
    perFile,
    graph,
    toPath,
    exempt: target.exempt ?? [],
    baseline: target.baseline ?? [],
  });
};

/**
 * Why a gate result fails a run, in one clause, or nothing when it does not.
 *
 * One function rather than the same three conditions at both call sites, because
 * `--render` and a fresh measurement disagreeing about what counts as a failure
 * is precisely the kind of drift this harness exists to make visible in other
 * people's code.
 *
 * Four failures, in the order a reader wants them. Files nobody has an excuse
 * for first: that is the new red R124 is about. Then a baseline whose count no
 * longer matches, in either direction. Then an exemption nobody has re-read.
 * And last, output the gate could not place in any file (R154), which is rarer
 * than the other three and would otherwise surface as a file wrongly unread. The
 * known red is not here at all - it is written in the report, named with the
 * ticket it belongs to, and it is the whole reason the first clause can be
 * trusted.
 */
const whyGateFails = (result) => {
  if (result === undefined) return undefined;
  const said = [];
  if (result.missing.length > 0) said.push(`${result.missing.length} file(s) with sites and no output`);
  for (const row of result.drift) {
    said.push(
      `the baseline for ${row.path} (${row.family}) says ${row.files} and the run found ${row.found}`,
    );
  }
  if (result.stale.length > 0) said.push(`${result.stale.length} exemption(s) no longer needed`);
  // Output no configured service can be named for speaks for no file, so it
  // fails the run rather than being taken as read at the clone's root (R154).
  if ((result.unplaced ?? []).length > 0) {
    said.push(`${result.unplaced.length} output(s) of the graph placed in no file`);
  }
  return said.length === 0 ? undefined : said.join('; ');
};

// ------------------------------------------------------------------ command

/**
 * Write the report, keeping what it was made from beside the build.
 *
 * The kept copy is what `--render` reads. It is in the cache rather than
 * committed, because it is the measurement rather than the report: two files
 * saying the same thing in a review is one file too many.
 */
const publish = (target, state, workspace, result) => {
  writeFileSync(join(workspace, 'measured.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const file = join(REPORTS, `${target.name}${state === 'with-deps' ? '.with-deps' : ''}.md`);
  writeFileSync(file, renderReport(result), 'utf8');
  return file;
};

/**
 * Re-write the reports from measurements already in the cache.
 *
 * The counting rule and the wording of a report change far more often than the
 * repositories do, and rebuilding five gigabytes of somebody else's
 * source to find out whether a regular expression now counts four more routes
 * is a poor trade. Ground truth is counted again, because that is what changed;
 * nothing is cloned, installed, cleaned or built.
 */
const render = async (chosen) => {
  for (const target of chosen) {
    const cloneDir = join(CACHE, 'repos', target.name);
    if (!existsSync(cloneDir)) {
      console.log(`[${target.name}] no clone in the cache; skipped`);
      continue;
    }
    const { truth, perFile } = await groundTruth(cloneDir, target.read);
    for (const state of ['fresh', 'with-deps']) {
      const workspace = join(CACHE, 'work', `${target.name}.${state}`);
      const kept = join(workspace, 'measured.json');
      if (!existsSync(kept)) continue;
      const measured = JSON.parse(readFileSync(kept, 'utf8'));
      const graphPath = join(workspace, OUTPUT, 'project-graph.json');
      const graph = existsSync(graphPath) ? JSON.parse(readFileSync(graphPath, 'utf8')) : undefined;
      const result = {
        ...measured,
        truth,
        gate: gate(target, state, measured.services ?? [], perFile, graph),
      };
      console.log(`[${target.name}] re-rendered ${relative(ROOT, publish(target, state, workspace, result))}`);
      const why = whyGateFails(result.gate);
      if (why !== undefined) {
        console.error(`[${target.name}] read gate: ${why}`);
        process.exitCode = 1;
      }
    }
  }
};

/**
 * What the harness takes, and what it refuses.
 *
 * An unknown argument has always ended the run - the throw was in the commit that
 * created this file, and a ticket saying otherwise was written from a symptom by
 * somebody who had not read the function. What it did not do was say what was
 * meant: it threw a bare `Error`, so `--deps` produced thirty lines of stack
 * trace with the word "unknown" in the middle of it and no mention of the flag
 * that exists.
 *
 * So the refusal now names the vocabulary, and - where the mistake is one
 * somebody has actually made - the flag that was wanted. `MEANT` is that second
 * part, a lookup and not a spell checker, because guessing at what a stranger's
 * typo meant is how a harness ends up answering the wrong question confidently.
 * A missing value and a `--timeout` that is not a number are refused for the
 * same reason: `--target` with nothing after it used to reach "no target
 * matched", which is true and unhelpful.
 */
const USAGE = [
  'usage: node scripts/coverage/run.mjs [options]',
  '  --target NAME   measure one target; repeatable (default: all of them)',
  '  --install       install dependencies first, and write the with-deps report',
  '  --render        re-write reports from measurements already in the cache',
  '  --pin           re-pin every target to the head of its default branch',
  '  --timeout SECS  give up on one command after this long (default 1200)',
].join('\n');

/** Arguments somebody has written meaning one of the above. */
const MEANT = {
  '--deps': '--install',
  '--with-deps': '--install',
  '--dependencies': '--install',
  '--install-deps': '--install',
  '--targets': '--target',
  '--repo': '--target',
  '--only': '--target',
  '--render-only': '--render',
};

class UsageError extends Error {}

const parseArgs = (argv) => {
  const options = { targets: [], install: false, pin: false, render: false, timeoutMs: 20 * 60 * 1000 };
  const take = {
    '--target': (value) => options.targets.push(value),
    '--timeout': (value) => {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new UsageError(`--timeout wants a number of seconds, and was given "${value}"`);
      }
      options.timeoutMs = seconds * 1000;
    },
  };
  const flag = {
    '--install': () => (options.install = true),
    '--pin': () => (options.pin = true),
    '--render': () => (options.render = true),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (Object.hasOwn(flag, arg)) {
      flag[arg]();
      continue;
    }
    if (Object.hasOwn(take, arg)) {
      const value = argv[(index += 1)];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${arg} wants a value after it, and there is none`);
      }
      take[arg](value);
      continue;
    }
    const meant = Object.hasOwn(MEANT, arg) ? MEANT[arg] : undefined;
    throw new UsageError(
      `unknown argument: ${arg}${meant === undefined ? '' : `. The flag that exists is ${meant}`}`,
    );
  }
  return options;
};

const toolVersion = () =>
  JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8')).version;

const pin = async (list) => {
  for (const target of list.targets) {
    target.commit = await headOf(target);
    console.log(`${target.name.padEnd(12)} ${target.commit}`);
  }
  writeFileSync(TARGETS, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
};


/**
 * Refuse to measure a tool that is not the tool in the tree.
 *
 * The harness runs `packages/cli/bin/flowatlas.js`, which loads a **bundle**. A
 * reader changed in `src` and not rebuilt is not in that bundle, so a
 * measurement taken after the change is a measurement of the code before it -
 * and it comes back byte-identical to the baseline, which reads as "the fix did
 * nothing". Two agents were caught by this on the day the harness was first used
 * in earnest, and the first diagnosis blamed a stale graph in the clone; the
 * mechanism is simpler and worse than that, because no cache is involved and
 * nothing anywhere is wrong except that nobody ran a build.
 *
 * So the newest source in the workspace is compared against the newest file the
 * command loads, and a run is refused rather than answered. Modification times
 * are the right instrument here despite being a weak one: the question is not
 * "is this bundle correct" - a hash would answer that and would cost a bundle of
 * its own to compute - but "did somebody edit a reader and forget", and an mtime
 * answers exactly that.
 */
const newestUnder = (dir, extensions) => {
  let newest = 0;
  const visit = (at) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') visit(path);
        continue;
      }
      if (!extensions.some((extension) => entry.name.endsWith(extension))) continue;
      try {
        newest = Math.max(newest, statSync(path).mtimeMs);
      } catch {
        /* gone between the listing and the stat */
      }
    }
  };
  visit(dir);
  return newest;
};

const refuseIfStale = () => {
  const built = newestUnder(join(ROOT, 'packages', 'cli', 'dist'), ['.js']);
  if (built === 0) {
    throw new UsageError('there is no built command to measure. Run `pnpm -r build` first.');
  }
  let newest = 0;
  let where = '';
  for (const entry of readdirSync(join(ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const at = newestUnder(join(ROOT, 'packages', entry.name, 'src'), ['.ts', '.tsx']);
    if (at > newest) {
      newest = at;
      where = entry.name;
    }
  }
  if (newest > built) {
    throw new UsageError(
      `packages/${where}/src has changed since the command was built, and the harness ` +
        'measures the build. Run `pnpm -r build` first, or this run answers for the code ' +
        'as it was.',
    );
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(TARGETS)) {
    throw new UsageError(
      `no targets: ${relative(ROOT, TARGETS)} does not exist. Copy ` +
        `${relative(ROOT, TARGETS_EXAMPLE)} to it and list the repositories to measure; ` +
        'the file is gitignored.',
    );
  }
  const list = JSON.parse(readFileSync(TARGETS, 'utf8'));
  if (options.pin) return pin(list);

  const chosen =
    options.targets.length === 0
      ? list.targets
      : list.targets.filter((target) => options.targets.includes(target.name));
  if (chosen.length === 0) {
    throw new UsageError(
      `no target matched. The targets are: ${list.targets.map((t) => t.name).join(', ')}`,
    );
  }
  const unpinned = chosen.filter((target) => target.commit === null);
  if (unpinned.length > 0) {
    throw new Error(
      `not pinned: ${unpinned.map((t) => t.name).join(', ')}. Run with --pin first.`,
    );
  }

  mkdirSync(REPORTS, { recursive: true });
  if (options.render) return render(chosen);
  refuseIfStale();
  const state = options.install ? 'with-deps' : 'fresh';
  const version = toolVersion();
  const failures = [];
  const gateFailures = [];

  for (const target of chosen) {
    const log = (line) => console.log(`[${target.name}] ${line}`);
    try {
      const cloneDir = await clone(target, log);
      if (!options.install) await freshen(cloneDir);
      const installs = options.install ? await install(cloneDir, target, log) : [];
      const { truth, perFile } = await groundTruth(cloneDir, target.read);
      const { workspace, graph, ...measured } = await measure(
        target,
        cloneDir,
        state,
        log,
        options.timeoutMs,
      );
      const checked = gate(target, state, measured.services, perFile, graph);
      const why = whyGateFails(checked);
      if (why !== undefined) {
        log(`read gate: ${why}`);
        gateFailures.push(`${target.name} (${state}): ${why}`);
      } else if (checked !== undefined && checked.known.length > 0) {
        // A target passing *against its baseline* says so out loud, because the
        // number it is passing with is not zero and a reader who saw only "ok"
        // would be told less than the report holds.
        log(
          `read gate ok against its baseline: ${checked.known.length} known file(s) still unread, ${checked.blind} kind(s) of failure it cannot see`,
        );
      }
      const result = { target, state, version, truth, installs, ...measured, gate: checked };
      log(`wrote ${relative(ROOT, publish(target, state, workspace, result))}`);
    } catch (cause) {
      // Only the harness's own failures land here: a crashed build is a
      // measured outcome and never reaches this.
      failures.push(`${target.name}: ${cause.message}`);
      log(`harness error: ${cause.message}`);
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} target(s) could not be measured:`);
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
  // The gate fails the run rather than only writing a section, because a report
  // nobody opens is how the silent-skip class stayed quiet for twenty-five
  // defects. Each one is either a reader giving up without a row, or an
  // exemption somebody owes a sentence for.
  if (gateFailures.length > 0) {
    console.error(`\n${gateFailures.length} target(s) failed the read gate:`);
    for (const failure of gateFailures) console.error(`  ${failure}`);
    process.exitCode = 1;
  }
};

// A usage mistake is not a crash and is not worth a stack trace: it is the
// harness saying it does not know what was asked, which is the whole point of
// refusing it. Anything else is a genuine fault and keeps its trace.
await main().catch((cause) => {
  if (!(cause instanceof UsageError)) throw cause;
  console.error(`${cause.message}\n\n${USAGE}`);
  process.exitCode = 2;
});
