/** Job payload shapes. The queue name is the channel; these are what travels on it. */

export interface SendEmailJob {
  to: string;
  template: string;
  variables: Record<string, string>;
}

export interface SendDigestJob {
  to: string;
  since: string;
}

export interface ReportJob {
  reportId: string;
  format: 'pdf' | 'csv';
}

/** Queue names declared in this repo. */
export const MAIL_QUEUE = 'mail';
