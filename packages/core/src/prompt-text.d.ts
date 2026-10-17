/**
 * Types for `prompt-text.js`: one subject of the graph as the Markdown an
 * assistant is handed, written by the MCP server and the page alike (P97).
 *
 * The subject is the contract. The server gathers it from a database, the page
 * from its packed model, and everything after that is this one renderer.
 */

/** How much one text may say. */
export interface PromptLimits {
  /** Most chain steps written. */
  maxSteps: number;
  /** Most gaps written. */
  maxGaps: number;
  /** Most failure lines written, one per status and exception (P87). */
  maxFails: number;
  /** Most consumers of a channel written out with their steps. */
  maxConsumers: number;
  /** Most methods of a class, or nodes of a file, written (P95). */
  maxMembers: number;
  /** How many of each kind a service's lines name by id: ways in, crossings, findings (P95, P134). */
  maxFirst: number;
  /** The ceiling on the whole text, in characters. */
  maxChars: number;
}

export declare const PROMPT_LIMITS: Readonly<PromptLimits>;
export declare const PROMPT_WALK: Readonly<{
  maxNodes: number;
  depth: number;
  plumbingFanIn: number;
  reachDepth: number;
  reachNodes: number;
  reachedFrom: number;
}>;
export declare const PROMPT_MAX_NEXT: number;
export declare const PROMPT_FAIL_SOURCES: readonly ['throw', 'guard', 'pipe'];

/** One exception a helper can choose to throw (P90). */
export interface PromptFailChoice {
  exception: string;
  status?: number;
  assumed?: true;
}

/** One place a way in fails, as an entry stores it (core's `Failure`). */
export interface PromptFailure {
  status?: number;
  exception: string;
  /** Id of the code the failure is written in. */
  at: string;
  file?: string;
  line?: number;
  source: 'throw' | 'guard' | 'pipe';
  assumed?: true;
  declared?: number;
  via?: 'helper';
  chosenFrom?: PromptFailChoice[];
  family?: 'auth';
}

/** Each status and exception once, with its sites (core's `FailureGroup`). */
export interface PromptFailGroup<T extends PromptFailure = PromptFailure> {
  status?: number;
  exception: string;
  assumed?: true;
  declared?: number;
  via?: 'helper';
  chosenFrom?: PromptFailChoice[];
  family?: 'auth';
  sources: Array<T['source']>;
  sites: number;
  at: T[];
}

/**
 * What a way in answered at run time, beside what it declares (P106): core's
 * `FailureComparison` without its entry id.
 */
export interface PromptFailuresSeen {
  hits: number;
  window: { since?: string; from: string | null; to: string | null };
  undeclared: Array<{ status: number; count: number; share: number; expected?: string; maybe?: string[] }>;
  declaredSeen: Array<{ status: number; exception: string; count: number; assumed?: true }>;
  declaredNeverSeen: Array<{ status?: number; exception: string; at: string; loc?: string }>;
  tooFewHits?: true;
}

/** What a step's line is marked with beyond its join, as far as the reader knows. */
export interface PromptMarks {
  /** Runs only when the step before it fails, or under one that does. */
  failure?: true;
  /** Runs beside its siblings rather than after them. */
  together?: true;
  /** Runs once per item of a loop: the loop's kind as the code writes it (P69). */
  perItem?: string;
  /** The loop is a likely N+1 (P89). */
  nPlusOne?: true;
  /** Times real traffic went through the join, where a trace was imported (P65). */
  seen?: number;
  /**
   * How long the step took at run time (P111), in ms: the join's p95, or the
   * step's own span's when no join into it was seen.
   */
  p95?: number;
  /** The share of those requests that failed, 0 to 1, from the same row as `p95`. */
  errorRate?: number;
}

/** A line a step logs (P71). */
export interface PromptLog {
  level: string;
  line?: number;
  text?: string;
}

/** One step of the chain, in the order a walk reaches it. */
export interface PromptStep {
  /** Hops from the subject; 1 is a direct step. */
  depth: number;
  id: string;
  label: string;
  type: string;
  kind?: string;
  service?: string;
  /** Repo-relative `file:line`. */
  loc?: string;
  /** The edge that reached it: its type and how sure the join is. */
  via?: { type: string; confidence: string; because?: string[] };
  params?: string[];
  returns?: string;
  /** Already in the chain: a cycle, or a step written out under another one (P92). */
  repeat?: boolean;
  /** For a repeat that is not a cycle: the step its own line is under. */
  seenAt?: string;
  marks?: PromptMarks;
  logs?: PromptLog[];
}

/** Something on the chain the reading could not follow, and why. */
export interface PromptGap {
  reason: string;
  message: string;
  service?: string;
  loc?: string;
  hint?: string;
  /** The node the gap is recorded against, when it is one. */
  id?: string;
  /** How many ways in of its service reach the place, where the row says (P89). */
  waysIn?: number;
}

/** What stands in front of a way in (P76). */
export interface PromptAccess {
  guards: Array<{ name: string; where: string; via: string; skippedBy?: string }>;
  /** `skips`: the checks that read the opt-out's flag, comma-separated. */
  optOuts?: Array<{ decorator: string; where: string; public: boolean; skips: string }>;
}

/** One place of a check, and the node it is on when it names one. */
export interface PromptCheckPlace {
  loc?: string;
  message: string;
  hint?: string;
  on?: PromptStep;
}

/** What a scoped subject covers (P95): a class and its methods, a file and its nodes, a service's front. */
export type PromptScope = 'class' | 'file' | 'service';

/** A method of a class, or a node of a file. */
export interface PromptMember {
  id: string;
  label: string;
  type: string;
  kind?: string;
  loc?: string;
  /** For a file's node: the id of the class it belongs to; none for one that belongs to no class. */
  group?: string;
  /** The ways in that reach it (a class's method); empty for a file's node. */
  reachedFrom: PromptStep[];
  /** For a class's method: the walk from it, as a node's `steps`. */
  steps?: PromptStep[];
  stepsCut?: number;
  stepsCutBy?: string;
}

/** A count of one kind, with the first few of it. */
export interface PromptCount {
  kind: string;
  count: number;
  first: PromptStep[];
}

/** The requests between a service and one other, counted, with the first few. */
export interface PromptCrossing {
  service: string;
  count: number;
  first: Array<{ from: PromptStep; to: PromptStep; type: string }>;
}

/** A service's front (P95): what an assistant starts from. */
export interface PromptOverview {
  /** Its ways in by kind. */
  waysIn: PromptCount[];
  /** Requests and publishes it makes into each other service, and those made into it. */
  crossingsOut: PromptCrossing[];
  crossingsIn: PromptCrossing[];
  /** The channels it publishes onto and consumes. */
  publishes: PromptStep[];
  consumes: PromptStep[];
  /** Its findings by kind, ranked by reach, with the top rows of each. */
  findings: Array<{ kind: string; count: number; top: PromptGap[] }>;
  /** Its most common gaps, by reason, with the first place of each. */
  gaps: Array<{ reason: string; count: number; first: PromptGap }>;
}

export interface PromptSubject {
  id: string;
  /** The id is the page's key for it, the graph's id being unknown there. */
  key?: true;
  label: string;
  /** A node's type, or `check` for a gap id. */
  type: string;
  kind?: string;
  service?: string;
  loc?: string;
  /** When a scheduled way in fires (P71). */
  schedule?: { expression: string; zone?: string };
  /** Times a way in was hit at run time, where a trace was imported. */
  hits?: number;
  /** The way in's own p95 and error rate beside its hits (P111). */
  p95?: number;
  errorRate?: number;
  access?: PromptAccess;
  /** Every place a way in fails, ungrouped: the renderer groups them, and marks the steps they are thrown in. */
  fails?: PromptFailure[];
  /** What a way in answered at run time against what it declares, where a trace was imported (P106). */
  failuresSeen?: PromptFailuresSeen;
  /**
   * For a check: its places, and the name of the repository that is probably
   * missing when this gap is part of its evidence (P122).
   */
  check?: { places: PromptCheckPlace[]; missing?: string };
  /** `close`: the text is a task for an agent, and says so first (P122's Copy for agent). */
  task?: 'close';
  steps: PromptStep[];
  /** Steps the walk reached and left out. */
  stepsCut: number;
  /** The limit that left out more of them, when the walk was cut (P92). */
  stepsCutBy?: string;
  /** What publishes onto it, for a channel. */
  producers?: PromptStep[];
  /** The ways in that reach it, for something that is not one itself. */
  reachedFrom?: PromptStep[];
  gaps: PromptGap[];
  /** A class, a file or a service rather than one node (P95). */
  scope?: PromptScope;
  /** A class's methods, a file's nodes. */
  members?: PromptMember[];
  /** A service's front. */
  overview?: PromptOverview;
}

export declare const renderPrompt: (subject: PromptSubject, limits?: Partial<PromptLimits>) => string;
export declare const askNextOf: (subject: PromptSubject) => string[];
export declare const promptHintsFor: (node: { id: string; type: string; key?: true } | undefined | null) => string[];
export declare const promptNextFor: (...nodes: Array<{ id: string; type: string; key?: true } | undefined | null>) => string[];
export declare const groupFails: <T extends PromptFailure>(fails: readonly T[]) => Array<PromptFailGroup<T>>;
export declare const compareFailChoices: (a: PromptFailChoice, b: PromptFailChoice) => number;
export declare const promptFit: (lines: readonly string[], maxChars: number) => string;

/** The ways of closing a check, by remedy, each with the reasons it closes (P122). */
export type PromptRemedy =
  | 'link'
  | 'setting'
  | 'alias'
  | 'apiTarget'
  | 'pattern'
  | 'shape'
  | 'callsService'
  | 'flowatlasCalls'
  | 'channelMarker'
  | 'flowEntry'
  | 'advice';
export declare const PROMPT_REMEDY_REASONS: Readonly<Record<Exclude<PromptRemedy, 'advice'>, readonly string[]>>;
/** The ways of closing a reason, in the table's order; `advice` when the table lists none. */
export declare const promptRemediesOf: (reason: string) => PromptRemedy[];
/** A check's "How to close it" lines, accepting it last; none for a subject that is no gap id. */
export declare const promptRemedyLines: (subject: Pick<PromptSubject, 'id' | 'check'>) => string[];
/** A duration as the page and the text write it: `3.2 ms`, `73 ms`, `1.2 s` (P111). */
export declare const promptMsSay: (ms: number) => string;
/** A share, 0 to 1, as a percentage: `4.5%`, `100%` (P111). */
export declare const promptRateSay: (rate: number) => string;
