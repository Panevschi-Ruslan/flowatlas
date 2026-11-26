/**
 * The prompt hook's own entry point (P386): what Claude Code runs when a
 * prompt is submitted, built beside the command so a prompt that names
 * nothing pays a process start and one file read, never the command line.
 *
 * A prompt that names something loads the graph server, most of the time a
 * card takes; Node's compile cache keeps that load's compiled code between
 * runs, so it is paid once, not on every prompt.
 */
import { enableCompileCache } from 'node:module';
import { promptHookMain } from './agents/prompt-hook.js';

try {
  enableCompileCache?.();
} catch {
  // Slower without it, never wrong.
}
await promptHookMain(process.argv.slice(2));
