import type { ReportBuilder } from './reports.service';

/** Reports plugins register when they load: nothing written out to read. */
const registry = new Map<string, ReportBuilder>();

export const registerPluginReport = (builder: ReportBuilder): void => {
  registry.set(builder.kind, builder);
};

export const loadPluginReports = (): ReportBuilder[] => [...registry.values()];
