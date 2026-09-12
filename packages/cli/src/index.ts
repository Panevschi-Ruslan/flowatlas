import { FlowatlasError } from '@flowatlas/core';
import { Command } from 'commander';
import { registerBuild } from './commands/build.js';
import { registerChannel } from './commands/channel.js';
import { registerConfig } from './commands/config.js';
import { registerContracts } from './commands/contracts.js';
import { registerCycles } from './commands/cycles.js';
import { registerDead } from './commands/dead.js';
import { registerDiff } from './commands/diff.js';
import { registerDoctor } from './commands/doctor.js';
import { registerExtract } from './commands/extract.js';
import { registerFlow } from './commands/flow.js';
import { registerHotspots } from './commands/hotspots.js';
import { registerImpact } from './commands/impact.js';
import { registerInit } from './commands/init.js';
import { registerLink } from './commands/link.js';
import { registerMcp } from './commands/mcp.js';
import { registerStats } from './commands/stats.js';
import { registerTypes } from './commands/types.js';
import { registerVisualise } from './commands/visualise.js';
import { CliError, EXIT } from './exit.js';
import { VERSION } from './version.js';

export const createProgram = (): Command => {
  const program = new Command();
  program
    .name('flowatlas')
    .description('Cross-repository dependency and contract graph')
    .version(VERSION)
    .showHelpAfterError();
  registerInit(program);
  registerLink(program);
  registerExtract(program);
  registerBuild(program);
  registerMcp(program);
  registerFlow(program);
  registerImpact(program);
  registerChannel(program);
  registerTypes(program);
  registerContracts(program);
  registerStats(program);
  registerCycles(program);
  registerDead(program);
  registerDoctor(program);
  registerConfig(program);
  registerHotspots(program);
  registerVisualise(program);
  registerDiff(program);
  return program;
};

/** Parses and runs. Reports a failure on stderr and sets the exit code. */
export const run = async (argv: string[] = process.argv): Promise<void> => {
  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      for (const line of error.details) process.stderr.write(`${line}\n`);
      process.exitCode = error.code;
      return;
    }
    if (error instanceof FlowatlasError) {
      process.stderr.write(`${error.message}\n`);
      if (error.hint !== undefined) process.stderr.write(`${error.hint}\n`);
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exitCode = EXIT.cannotRun;
  }
};

export { buildProject, summariseBuild, summariseRebuild } from './commands/build.js';
export type { BuildOptions, BuildResult, BuildTiming } from './commands/build.js';
export {
  CACHE_VERSION,
  diffRepoFiles,
  hashConfig,
  hashFile,
  loadBuildCache,
  saveBuildCache,
  stampFiles,
} from './build/cache.js';
export type { BuildCache, FileStamp, RepoCache } from './build/cache.js';
export { planRebuild } from './build/incremental.js';
export type {
  IncrementalExtractor,
  PartialExtract,
  RebuildPlan,
  RepoSurvey,
  ServicePlan,
} from './build/incremental.js';
export { spliceRepoGraph } from './build/splice.js';
export { watchProject } from './build/watch.js';
export type { WatchHandle, WatchOptions } from './build/watch.js';
export { runExtract, summarise } from './commands/extract.js';
export { runInit, scanCandidates } from './commands/init.js';
export { linkRepos, unlinkRepos } from './commands/link.js';
export type { LinkOptions, LinkResult, UnlinkResult } from './commands/link.js';
export { installMcp, serverEntry, withServer, MCP_FILE, SERVER_KEY } from './commands/mcp.js';
export { runChannel } from './commands/channel.js';
export { runFlow } from './commands/flow.js';
export { runImpact } from './commands/impact.js';
export { runStats, collectStats, summariseStats } from './commands/stats.js';
export type { Stats } from './commands/stats.js';
export { runTypes, driftOf, globToRegExp, DRIFT_NOTE } from './commands/types.js';
export type { Drift } from './commands/types.js';
export { runContracts, registerContracts, CONTRACTS_FILE, FAIL_LEVELS } from './commands/contracts.js';
export type { ContractsFormat, ContractsOptions, ContractsRun, FailLevel } from './commands/contracts.js';
export {
  byReason,
  renderContractsJson,
  renderContractsMarkdown,
  renderContractsText,
  summaryLine,
  truncationNote,
} from './render/contracts.js';
export type { ContractRenderOptions } from './render/contracts.js';
export { CliError, EXIT, cannotRun, notFound } from './exit.js';
export type { ExitCode } from './exit.js';
export { openDbFromOptions, sourceRootsFor } from './db.js';
export type { DbOptions } from './db.js';
export { DEFAULT_DEPTH, FORMATS, querySettings, withQueryOptions } from './options.js';
export type { Format, QueryOptions, QuerySettings } from './options.js';
export { present, processIo } from './query/answer.js';
export type { Answer, QueryIo } from './query/answer.js';
export { collectSource, collectTypes } from './query/detail.js';
export { callersOf, groupEntries, reachableSummary } from './query/callers.js';
export type { Callers, ReachableGroup } from './query/callers.js';
export { channelIdOf, resolveChannel, resolveEntry, resolveSymbol } from './query/refs.js';
export {
  CONFIDENCE_MARK,
  NODE_PREFIX,
  getRenderer,
  graphOf,
  renderJson,
  renderMermaid,
  renderTree,
  repoPalette,
  sanitiseIds,
  truncationLine,
} from './render/index.js';
export type { RenderOptions, Renderer, RepoPalette, SourceBlock } from './render/index.js';
export { runCycles, CYCLE_EDGES } from './commands/cycles.js';
export { runDead } from './commands/dead.js';
export {
  registerDoctor,
  runDoctorCommand,
  BASELINE_FILE,
  DOCTOR_FILE,
} from './commands/doctor.js';
export type { DoctorFormat, DoctorOptions, DoctorRun } from './commands/doctor.js';
export { runDoctor } from './doctor/run.js';
export type { DoctorInput, DoctorSettings } from './doctor/run.js';
export {
  BASELINE_FORMAT_VERSION,
  DOCTOR_FORMAT_VERSION,
  SECTIONS,
  doctorReportSchema,
  parseDoctorReport,
} from './doctor/schema.js';
export type {
  BaselineDelta,
  DesyncRow,
  DoctorReport,
  DoctorRow,
  DoctorVerdict,
  ReasonGroup,
  Section,
} from './doctor/schema.js';
export {
  acceptedBy,
  baselineSchema,
  compareBaseline,
  isActionable,
  isProblem,
  readBaseline,
  snapshotOf,
  unresolvedKey,
  writeBaseline,
} from './doctor/baseline.js';
export type { Baseline, BaselineRead, KeyCount, UnresolvedSnapshot } from './doctor/baseline.js';
export { HINTS, KNOWN_REASONS, SHARPENERS, genericHint, hintFor, isKnownReason } from './doctor/hints.js';
export type { HintContext, HintTemplate } from './doctor/hints.js';
export { MARKER_CODES, validateMarkers } from './doctor/markers.js';
export type { MarkerCode, MarkerIssue, MarkerOptions } from './doctor/markers.js';
export {
  placeOf,
  renderDoctorGithub,
  renderDoctorJson,
  renderDoctorText,
  summaryLine as doctorSummaryLine,
} from './doctor/render.js';
export { runConfig, SelectorError } from './commands/config.js';
export { runHotspots, HOTSPOT_EDGES } from './commands/hotspots.js';
export { runDiff, registerDiff, DIFF_FILE } from './commands/diff.js';
export type { DiffFormat, DiffOptions, DiffRun } from './commands/diff.js';
export { runCache, registerCache, CACHE_ACTIONS } from './commands/cache.js';
export type { CacheAction, CacheOptions, CacheRun } from './commands/cache.js';
export { buildAtRef } from './git/build-at-ref.js';
export type { BuildAtRefOptions, BuildAtRefResult } from './git/build-at-ref.js';
export { GraphCache } from './git/graph-cache.js';
export type { CacheEntry, CacheMeta, CacheRow } from './git/graph-cache.js';
export { isDirty, isGitRepo, pruneWorktrees, resolveSha, withWorktree } from './git/worktree.js';
export type { Checkout, NodeModules } from './git/worktree.js';
export { classifyContracts, contractBreaks } from './report/contract-delta.js';
export { renderDiffMarkdown, summariseDiff } from './report/diff-markdown.js';
export type { DiffMarkdownOptions } from './report/diff-markdown.js';
export { runVisualise } from './commands/visualise.js';
export type { VisualiseOptions, VisualiseResult } from './commands/visualise.js';
export { packGraph } from './visualise/pack.js';
export type { PackedGraph, PackInput } from './visualise/pack.js';
export { buildGraph, loadGraph, methodsByOwner } from './analysis/graph.js';
export type { AnalysisEdge, AnalysisGraph, AnalysisNode } from './analysis/graph.js';
export { tarjanScc } from './analysis/scc.js';
export type { Cycle, CycleHop, SccOptions } from './analysis/scc.js';
export { inDegree } from './analysis/degree.js';
export type { DegreeOptions, DegreeRow } from './analysis/degree.js';
export {
  EXTERNALLY_TRIGGERED,
  deadChannels,
  deadEntries,
  deadFields,
  deadProviders,
  unresolvedInjectCount,
} from './analysis/dead.js';
export type { DeadChannel, DeadEntry, DeadField, DeadProvider, DeadOptions } from './analysis/dead.js';
export { CONFIG_EDGES, configAlongFlow, configEverywhere } from './analysis/config-keys.js';
export type { ConfigKeyRow, ConfigRead, ConfigResultBody } from './analysis/config-keys.js';
export {
  ANALYTICS_FORMAT_VERSION,
  configResultSchema,
  cyclesResultSchema,
  deadResultSchema,
  hotspotsResultSchema,
} from './analysis/shapes.js';
export type { ConfigResult, CyclesResult, DeadResult, HotspotsResult } from './analysis/shapes.js';
export { explainSelection, resolveSelector, selectionHint } from './query/selector.js';
export type { Selection } from './query/selector.js';
export { moreRows, renderTable, section } from './format/table.js';
export type { Column } from './format/table.js';

export { VERSION } from './version.js';
