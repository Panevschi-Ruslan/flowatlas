/**
 * The search hook's own entry point (P227 D6): what Claude Code runs after a
 * search, built beside the command so a search never loads the command line.
 */
import { runSearchHook } from './agents/search-hook.js';

await runSearchHook(process.argv.slice(2));
