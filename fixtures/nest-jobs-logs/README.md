# nest-jobs-logs

A scheduled job with the zone it fires in, and the lines each step writes to its log.

| Written | Read as |
|---|---|
| `@Cron('0 3 * * *', { name: 'nightly-cleanup', timeZone: 'Europe/Paris' })` | a schedule entry with `meta.timeZone` |
| `this.logger.log(`removed ${count} drafts`)` | `logs: [{ level: 'log', text: 'removed {count} drafts', at }]` |
| `console.warn('no drafts older than ' + days + ' days')` | `text: 'no drafts older than {days} days'` |
| `this.logger.error(err)` | a line with a level and no template |
| `logger.debug({ id }, 'archived')` | the words after the fields |

Templates only: an interpolated value is named by what holds it, never by what it holds.
