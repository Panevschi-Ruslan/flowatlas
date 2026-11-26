import convict from 'convict';

/** The ledger's settings, as a schema: LEDGER_PORT, or 3005. */
export const config = convict({
  port: {
    doc: 'The port the ledger listens on',
    format: 'port',
    default: 3005,
    env: 'LEDGER_PORT',
  },
});
