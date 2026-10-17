import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withNext } from '../query/next.js';
import { READ_ONLY, respond, type PatternTesterRule, type ToolContext } from './common.js';

/**
 * `test_pattern`: a draft rule checked before it is suggested (P121).
 *
 * The rule is YAML as a pattern file holds it, one rule or a list; the code
 * is a call the rule is meant to read. The answer is what `flowatlas patterns
 * test` says - each rule refused with the part named, or its own tests run,
 * and what it draws from the code, with the holes it filled - from the same
 * tester, which runs the reader the build runs, in memory. Bounded: at most
 * ten rules and ten tests a rule are answered.
 */

const MOST_RULES = 10;
const MOST_TESTS = 10;
const MOST_DRAWN = 10;

const bounded = (rule: PatternTesterRule): PatternTesterRule => ({
  ...rule,
  tests: rule.tests.slice(0, MOST_TESTS).map((test) => ({ ...test, drew: test.drew.slice(0, MOST_DRAWN), rows: test.rows.slice(0, MOST_DRAWN) })),
  ...(rule.code === undefined ? {} : { code: { ...rule.code, drew: rule.code.drew.slice(0, MOST_DRAWN), rows: rule.code.rows.slice(0, MOST_DRAWN) } }),
});

export const registerPatterns = (server: McpServer, ctx: ToolContext): void => {
  server.registerTool(
    'test_pattern',
    {
      title: 'Test a pattern rule',
      description: "Runs a draft extraction pattern (YAML) over code with the build's reader: what it draws, or why it is refused.",
      inputSchema: {
        yaml: z.string().min(1).describe('one rule or a list'),
        code: z.string().optional().describe('a call the rule should read'),
        service: z.string().optional(),
      },
      annotations: READ_ONLY,
    },
    async (input) => {
      if (ctx.patternTester === undefined) {
        return respond({ error: 'test_pattern runs the readers, which this server was started without; run flowatlas mcp, or flowatlas patterns test' });
      }
      const answer = await ctx.patternTester({
        yaml: input.yaml,
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.service === undefined ? {} : { service: input.service }),
      });
      if (answer.error !== undefined) return respond({ error: answer.error });
      const rules = answer.rules.slice(0, MOST_RULES).map(bounded);
      const refused = rules.find((rule) => rule.refused !== undefined);
      const next = refused !== undefined
        ? [`fix ${refused.refused?.part ?? 'the rule'} of ${refused.id}, then test_pattern again`]
        : ['run: flowatlas patterns test, once the rule is in a pattern file listed under "patterns"'];
      return respond(withNext({ rules, ...(answer.rules.length > MOST_RULES ? { truncated: answer.rules.length - MOST_RULES } : {}) }, next));
    },
  );
};
