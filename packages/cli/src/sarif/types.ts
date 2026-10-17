/**
 * The part of SARIF 2.1.0 (OASIS) this tool writes, and the input it is
 * written from (P115).
 *
 * SARIF is the format every CI already shows: a result on the line it is
 * about, an alert that stays open while the finding does and closes when it
 * is fixed. The log types are the standard's, narrowed to the properties a
 * flowatlas log fills; `SarifInput` is flowatlas's own, one shape every
 * command's report is adapted to, so the level map, the fingerprints and the
 * placement are decided once (I4 of the ticket).
 */

/** The three levels a result is written at. `none` is never written. */
export const SARIF_LEVELS = ['error', 'warning', 'note'] as const;
export type SarifLevel = (typeof SARIF_LEVELS)[number];

/** The commands that write a log, each its own category (D1). */
export const SARIF_COMMANDS = ['contracts', 'dead', 'cycles', 'rules', 'doctor', 'diff', 'check'] as const;
export type SarifCommand = (typeof SARIF_COMMANDS)[number];

/** How a result compares with what was there before (SARIF §3.27.24). */
export type BaselineState = 'new' | 'unchanged' | 'updated' | 'absent';

export interface SarifMessage {
  text: string;
  markdown?: string;
}

export interface SarifArtifactLocation {
  uri?: string;
  uriBaseId?: string;
  description?: SarifMessage;
}

export interface SarifRegion {
  startLine: number;
}

export interface SarifPhysicalLocation {
  artifactLocation: SarifArtifactLocation;
  region?: SarifRegion;
}

export interface SarifLocation {
  id?: number;
  physicalLocation?: SarifPhysicalLocation;
  message?: SarifMessage;
}

export interface SarifThreadFlowLocation {
  location: SarifLocation;
  executionOrder?: number;
}

export interface SarifCodeFlow {
  message?: SarifMessage;
  threadFlows: Array<{ locations: SarifThreadFlowLocation[] }>;
}

export interface SarifSuppression {
  kind: 'inSource' | 'external';
  justification?: string;
}

export interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: SarifLevel;
  message: SarifMessage;
  locations: SarifLocation[];
  relatedLocations?: SarifLocation[];
  codeFlows?: SarifCodeFlow[];
  partialFingerprints: Record<string, string>;
  baselineState?: BaselineState;
  suppressions?: SarifSuppression[];
  properties?: Record<string, unknown>;
}

export interface SarifReportingDescriptor {
  id: string;
  name?: string;
  shortDescription: SarifMessage;
  fullDescription?: SarifMessage;
  help: SarifMessage;
  defaultConfiguration: { level: SarifLevel };
  properties?: Record<string, unknown>;
}

export interface SarifNotification {
  level: SarifLevel;
  message: SarifMessage;
  descriptor?: { id: string };
}

export interface SarifRun {
  tool: {
    driver: {
      name: string;
      version: string;
      semanticVersion: string;
      informationUri: string;
      rules: SarifReportingDescriptor[];
    };
  };
  automationDetails: { id: string };
  originalUriBaseIds: Record<string, SarifArtifactLocation>;
  invocations: Array<{ executionSuccessful: boolean; toolExecutionNotifications?: SarifNotification[] }>;
  results: SarifResult[];
  properties?: Record<string, unknown>;
}

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: SarifRun[];
}

/**
 * Where something is, as a report knows it: a path inside the repository of
 * `service`, or (no service) a path relative to the configuration already —
 * a document-declared service's rows, and the configuration itself.
 */
export interface SarifPlace {
  service?: string;
  /** Empty when the place is known only by its service. */
  file: string;
  /** 0 or absent: the file, with no region (never a guessed line). */
  line?: number;
}

/** One location beside the primary one, or one step of a flow. */
export interface SarifStep {
  place: SarifPlace | undefined;
  message: string;
}

/** The rule a result is reported under, as the catalogue or a report describes it. */
export interface SarifRuleInfo {
  id: string;
  /** A few words: the reason's label. */
  short: string;
  /** What to do, plain text. */
  help: string;
  /** The same, in Markdown; the text when absent. */
  helpMarkdown?: string;
  level: SarifLevel;
  properties?: Record<string, unknown>;
}

/**
 * One finding, as every report is adapted to it: what rule, how loud, where,
 * what else it touches, and what identifies it across edits.
 */
export interface SarifFinding {
  rule: SarifRuleInfo;
  /** Undefined: not written (a place with nothing to join, a note). */
  level: SarifLevel | undefined;
  message: string;
  /** Undefined: placed at the configuration line naming `fallbackService`, or the configuration (I3). */
  at: SarifPlace | undefined;
  /** The service whose configuration line takes a finding with no file. */
  fallbackService?: string;
  /** The rule whose configuration line takes a finding with no file. */
  fallbackRule?: string;
  related?: SarifStep[];
  /** A chain, in order: a rule violation's path, a cycle's hops. */
  flow?: SarifStep[];
  /** The line-free key a baseline already keys on, with the kind it belongs to (D2). */
  key: { kind: string; value: string };
  baselineState?: BaselineState;
  suppression?: SarifSuppression;
  properties?: Record<string, unknown>;
}

/** Where the paths of a log are relative to, and how each service's are found. */
export interface SarifPaths {
  /** Each service's directory relative to the configuration, `./` stripped; a service at the root has none. */
  repoDirs: ReadonlyMap<string, string>;
  /** The configuration file, relative to its directory: where a finding with no file is placed. */
  configFile?: string;
  /** The line each service is named on in the configuration. */
  serviceLine?: (service: string) => number | undefined;
  /** The line each rule is named on in the configuration. */
  ruleLine?: (rule: string) => number | undefined;
  /** The configuration's directory, absolute: what `sarifRoot` is relative to. */
  rootDir?: string;
  /** `--sarif-root`, absolute: write paths relative to this one checkout instead. */
  sarifRoot?: string;
}

/** Everything `toSarif` needs; built by one adapter per report. */
export interface SarifInput {
  command: SarifCommand;
  version: string;
  findings: readonly SarifFinding[];
  paths: SarifPaths;
  /** Most results written (I9); the rest are counted in a notification. */
  maxResults?: number;
  /** `--sarif-level`: results below it are left out. */
  minLevel?: SarifLevel;
  /** Rows the report had already cut, said with the cut. */
  cutBefore?: number;
  /** Where the complete report is, named under any cut. */
  completeFile?: string;
  /** What the run says about itself that is no one result. */
  notes?: ReadonlyArray<{ level: SarifLevel; text: string }>;
}
