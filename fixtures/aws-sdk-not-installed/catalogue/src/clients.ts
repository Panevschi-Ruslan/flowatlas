import * as AWS from 'aws-sdk';

/**
 * A client constructed in one module and imported by another, which is how most
 * services keep theirs. The module is the repository's own, so the import is
 * followed with nothing installed, to the construction and the import beside it.
 */
export const sns = new AWS.SNS({ region: 'eu-west-1' });
