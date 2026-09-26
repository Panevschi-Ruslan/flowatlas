#!/usr/bin/env node
/**
 * Measure this tool against eight real repositories, repeatably.
 *
 *   node scripts/coverage/run.mjs                 # every target, fresh clones
 *   node scripts/coverage/run.mjs --target immich # one of them
 *   node scripts/coverage/run.mjs --install       # with dependencies installed
 *   node scripts/coverage/run.mjs --render        # re-write reports from the cache
 *   node scripts/coverage/run.mjs --pin           # re-pin the list to today
 *
 * This is not part of `pnpm check`. It clones the internet and takes minutes.
 * It is run deliberately - before a release, and after any change to a reader -
 * and it writes one report per target per state into `scripts/coverage/reports`,
 * which are committed, so an improvement in coverage arrives as a diff somebody
 * can read rather than as a claim somebody has to believe.
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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { byFamily, countSites, isSourceFile } from './counting-rule.mjs';
import { figuresFrom } from './figures.mjs';
import { renderReport } from './report.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(ROOT, 'packages', 'cli', 'bin', 'flowatlas.js');
const TARGETS = join(ROOT, 'scripts', 'coverage', 'targets.json');
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
 * actually said, which on two of these eight targets is the entire result.
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
  // this, payload's report carried three addresses in a dynamic library and not
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
    // the install in a sixth of a second. It did, on outline, and the report
    // dutifully recorded a repository with no dependencies as a repository with
    // dependencies installed. A version of Yarn is not a fact about outline, so
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
  return results;
};

// -------------------------------------------------------------- ground truth

/**
 * Ground truth for one target, by the one rule in `counting-rule.mjs`.
 *
 * The file list comes from git rather than from a directory walk, so an
 * installed `node_modules` and a build directory left over from an earlier
 * state are invisible and the denominator is the same in both states. That is
 * what makes the two reports comparable to each other as well as to the tool.
 */
const groundTruth = async (cloneDir, readRoots) => {
  const listed = await run(['git', 'ls-files', '-z', ...readRoots], { cwd: cloneDir });
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
  const sites = countSites(files);
  return { files: paths.length, sites, families: byFamily(sites) };
};

// ---------------------------------------------------------------- measuring

const flowatlas = (args, cwd, timeoutMs) => run([process.execPath, CLI, ...args], { cwd, timeoutMs });

/**
 * Apply the target's declared types over the ones `link` guessed.
 *
 * What `link` guessed is kept beside what was set, and both go in the report.
 * That matters: outline declares Koa and React in one manifest, `link` answers
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
  rmSync(workspace, { recursive: true, force: true });
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
  // `--json` that sentence is not printed at all, and novu's crash - the one
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
    const path = join(workspace, '.flowatlas', name);
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
  };
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
 * eight repositories do, and rebuilding five gigabytes of somebody else's
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
    const truth = await groundTruth(cloneDir, target.read);
    for (const state of ['fresh', 'with-deps']) {
      const workspace = join(CACHE, 'work', `${target.name}.${state}`);
      const kept = join(workspace, 'measured.json');
      if (!existsSync(kept)) continue;
      const result = { ...JSON.parse(readFileSync(kept, 'utf8')), truth };
      console.log(`[${target.name}] re-rendered ${relative(ROOT, publish(target, state, workspace, result))}`);
    }
  }
};

const parseArgs = (argv) => {
  const options = { targets: [], install: false, pin: false, render: false, timeoutMs: 20 * 60 * 1000 };
  const take = {
    '--target': (value) => options.targets.push(value),
    '--timeout': (value) => (options.timeoutMs = Number(value) * 1000),
  };
  const flag = {
    '--install': () => (options.install = true),
    '--pin': () => (options.pin = true),
    '--render': () => (options.render = true),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg in flag) flag[arg]();
    else if (arg in take) take[arg](argv[(index += 1)]);
    else throw new Error(`unknown argument: ${arg}`);
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

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const list = JSON.parse(readFileSync(TARGETS, 'utf8'));
  if (options.pin) return pin(list);

  const chosen =
    options.targets.length === 0
      ? list.targets
      : list.targets.filter((target) => options.targets.includes(target.name));
  if (chosen.length === 0) throw new Error('no target matched');
  const unpinned = chosen.filter((target) => target.commit === null);
  if (unpinned.length > 0) {
    throw new Error(
      `not pinned: ${unpinned.map((t) => t.name).join(', ')}. Run with --pin first.`,
    );
  }

  mkdirSync(REPORTS, { recursive: true });
  if (options.render) return render(chosen);
  const state = options.install ? 'with-deps' : 'fresh';
  const version = toolVersion();
  const failures = [];

  for (const target of chosen) {
    const log = (line) => console.log(`[${target.name}] ${line}`);
    try {
      const cloneDir = await clone(target, log);
      if (!options.install) await freshen(cloneDir);
      const installs = options.install ? await install(cloneDir, target, log) : [];
      const truth = await groundTruth(cloneDir, target.read);
      const { workspace, ...measured } = await measure(target, cloneDir, state, log, options.timeoutMs);
      const result = { target, state, version, truth, installs, ...measured };
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
};

await main();
