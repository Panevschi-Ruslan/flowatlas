/**
 * Edges that count toward being depended upon: what `flowatlas hotspots` ranks
 * by and the page's Busiest view ranks by too (P73), kept here so that the
 * page does not lean on a command to say it (P84).
 *
 * `imports` and `reads_config` are left out deliberately: a settings key read
 * forty times is not fragile, and a module everything imports is a fact about
 * Nest rather than about this project.
 */
export const HOTSPOT_EDGES = ['calls', 'http_calls', 'hits', 'consumes', 'injects'] as const;
