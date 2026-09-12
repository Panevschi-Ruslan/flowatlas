/**
 * What a health check says, and the shape a script may rely on.
 *
 * Two files come out of `doctor` and neither is the graph, so both are versioned
 * apart from it: the graph is rebuilt whenever anybody likes, while a build that
 * reads `doctor.json` breaks silently when a field moves. Bump the format
 * version when a field is removed or changes meaning.
 */
import { contractFindingSchema } from '@flowatlas/contracts';
import type { ContractFinding } from '@flowatlas/contracts';
import { z } from 'zod';
import { MARKER_CODES, type MarkerIssue } from './markers.js';

/** Version of `.flowatlas/doctor.json`. */
export const DOCTOR_FORMAT_VERSION = 1;

/** Version of `.flowatlas/baseline.json`, which moves independently. */
export const BASELINE_FORMAT_VERSION = 1;

/** The five things `doctor` looks at. Any subset can be asked for. */
export const SECTIONS = ['unresolved', 'markers', 'desync', 'contracts', 'baseline'] as const;

export type Section = (typeof SECTIONS)[number];

/** How a section ended up: it ran, it was asked not to, or it could not. */
export const SECTION_STATUSES = ['ok', 'skipped', 'unavailable'] as const;

export type SectionStatus = (typeof SECTION_STATUSES)[number];

/** One place the tool could not read, as it is printed. */
export interface DoctorRow {
  service: string;
  file: string;
  line: number;
  symbol: string | null;
  /** `action` for something to fix, `info` for a limit of static reading. */
  level: 'action' | 'info';
  /** How many places this row stands for; more than one only when informational. */
  sites: number;
  message: string;
  hint: string;
}

/** Every row of one reason, with the advice they share. */
export interface ReasonGroup {
  reason: string;
  level: 'action' | 'info';
  /** Rows in the list. */
  count: number;
  /** Places those rows stand for. Equal to `count` for anything actionable. */
  sites: number;
  /** False when the catalogue has no advice for this reason. */
  known: boolean;
  /** True when `doctor.ignoreReasons` takes this out of the growth check. */
  excluded: boolean;
  hint: string;
  rows: DoctorRow[];
  /** Rows left out of `rows` by `--max-nodes`. Absent when nothing was cut. */
  truncated?: number;
}

/** A call whose target route is not where it was expected to be. */
export interface DesyncRow {
  /** Id of the `http_out` or `ui_api_call` node. */
  call: string;
  service: string;
  method: string | null;
  path: string | null;
  baseUrlEnv: string | null;
  targetService: string | null;
  reason: string;
  file: string;
  line: number;
  message: string;
  hint: string;
}

/** How the project compares with what was accepted. */
export interface BaselineDelta {
  status: 'ok' | 'grew' | 'missing' | 'invalid' | 'skipped';
  /** Why, when the status is `invalid` or `missing`. */
  note: string | null;
  total: { baseline: number; current: number; delta: number };
  byReason: Array<{ reason: string; baseline: number; current: number; delta: number }>;
  /** Keys present now and not in the baseline. */
  newKeys: string[];
  /** Keys in the baseline and not present now. */
  goneKeys: string[];
  truncated?: number;
}

export interface DoctorVerdict {
  exitCode: 0 | 1 | 2;
  /** One sentence per thing that decided the code; empty when nothing did. */
  reasons: string[];
}

export interface DoctorReport {
  doctorFormatVersion: number;
  schemaVersion: number;
  flowatlasVersion: string;
  /** ISO-8601. Replaced with a fixed value before a snapshot is compared. */
  generatedAt: string;
  strict: boolean;
  /** Where the baseline was looked for, or null when none was. */
  baselinePath: string | null;
  /** Sections this run was asked for. */
  sections: Section[];
  /** Set when the rows were read from the database rather than the graph file. */
  note: string | null;
  unresolved: {
    status: SectionStatus;
    /**
     * What `--strict` compares: places a person can act on.
     *
     * The sum of `sites` over actionable rows, less any reason
     * `doctor.ignoreReasons` names. Informational rows are counted in `info`
     * and never here — no edit to the repository would remove one, so a build
     * that failed on them would be asking for the impossible.
     */
    total: number;
    /** Rows in the whole list, actionable and informational alike. */
    rows: number;
    /** Places all of those rows stand for. */
    sites: number;
    info: { rows: number; sites: number };
    excluded: { reasons: string[]; sites: number };
    byReason: ReasonGroup[];
    /** Reasons the catalogue has never heard of, each named once. */
    unknownReasons: string[];
  };
  markers: {
    status: SectionStatus;
    note: string | null;
    errors: number;
    warnings: number;
    issues: MarkerIssue[];
    truncated?: number;
  };
  desync: {
    status: SectionStatus;
    rows: DesyncRow[];
    truncated?: number;
  };
  contracts: {
    status: SectionStatus;
    note: string | null;
    errors: ContractFinding[];
    errorCount: number;
    ignored: number;
    unchecked: number;
    truncated?: number;
  };
  baseline: BaselineDelta;
  verdict: DoctorVerdict;
}

const level = z.enum(['action', 'info']);
const status = z.enum(SECTION_STATUSES);
const truncated = z.number().int().positive().optional();

export const doctorRowSchema = z.object({
  service: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  symbol: z.string().nullable(),
  level,
  sites: z.number().int().positive(),
  message: z.string(),
  hint: z.string().min(1),
});

export const markerIssueSchema = z.object({
  code: z.enum(MARKER_CODES),
  severity: z.enum(['error', 'warning']),
  marker: z.string(),
  argument: z.string().nullable(),
  symbol: z.string(),
  service: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  message: z.string(),
  hint: z.string().min(1),
});

export const desyncRowSchema = z.object({
  call: z.string(),
  service: z.string(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  baseUrlEnv: z.string().nullable(),
  targetService: z.string().nullable(),
  reason: z.string(),
  file: z.string(),
  line: z.number().int().nonnegative(),
  message: z.string(),
  hint: z.string().min(1),
});

export const doctorReportSchema = z.object({
  doctorFormatVersion: z.literal(DOCTOR_FORMAT_VERSION),
  schemaVersion: z.number().int().nonnegative(),
  flowatlasVersion: z.string(),
  generatedAt: z.string(),
  strict: z.boolean(),
  baselinePath: z.string().nullable(),
  sections: z.array(z.enum(SECTIONS)),
  note: z.string().nullable(),
  unresolved: z.object({
    status,
    total: z.number().int().nonnegative(),
    rows: z.number().int().nonnegative(),
    sites: z.number().int().nonnegative(),
    info: z.object({
      rows: z.number().int().nonnegative(),
      sites: z.number().int().nonnegative(),
    }),
    excluded: z.object({
      reasons: z.array(z.string()),
      sites: z.number().int().nonnegative(),
    }),
    byReason: z.array(
      z.object({
        reason: z.string(),
        level,
        count: z.number().int().nonnegative(),
        sites: z.number().int().nonnegative(),
        known: z.boolean(),
        excluded: z.boolean(),
        hint: z.string().min(1),
        rows: z.array(doctorRowSchema),
        truncated,
      }),
    ),
    unknownReasons: z.array(z.string()),
  }),
  markers: z.object({
    status,
    note: z.string().nullable(),
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    issues: z.array(markerIssueSchema),
    truncated,
  }),
  desync: z.object({ status, rows: z.array(desyncRowSchema), truncated }),
  contracts: z.object({
    status,
    note: z.string().nullable(),
    errors: z.array(contractFindingSchema),
    errorCount: z.number().int().nonnegative(),
    ignored: z.number().int().nonnegative(),
    unchecked: z.number().int().nonnegative(),
    truncated,
  }),
  baseline: z.object({
    status: z.enum(['ok', 'grew', 'missing', 'invalid', 'skipped']),
    note: z.string().nullable(),
    total: z.object({
      baseline: z.number().int().nonnegative(),
      current: z.number().int().nonnegative(),
      delta: z.number().int(),
    }),
    byReason: z.array(
      z.object({
        reason: z.string(),
        baseline: z.number().int().nonnegative(),
        current: z.number().int().nonnegative(),
        delta: z.number().int(),
      }),
    ),
    newKeys: z.array(z.string()),
    goneKeys: z.array(z.string()),
    truncated,
  }),
  verdict: z.object({
    exitCode: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    reasons: z.array(z.string()),
  }),
});

/** Reads a report back, or says which field is wrong. */
export const parseDoctorReport = (value: unknown): DoctorReport =>
  doctorReportSchema.parse(value) as DoctorReport;
