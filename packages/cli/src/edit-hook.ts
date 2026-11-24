/**
 * The edit hook's own entry point (P387): what Claude Code runs after an edit,
 * built beside the command so an edit never loads the command line.
 */
import { runEditHook } from './agents/edit-hook.js';

await runEditHook(process.argv.slice(2));
