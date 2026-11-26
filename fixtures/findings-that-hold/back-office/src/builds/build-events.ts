export interface JobQueuedEvent {
  type: 'JOB_QUEUED';
  jobId: string;
  priority?: number;
}

/** A retry, as the back office expects it; the relay hands this handler BUILD_FAILED instead. */
export interface BuildRetriedEvent {
  type: 'BUILD_RETRIED';
  jobId: string;
  attempt?: number;
}

export interface BuildDoneEvent {
  type: 'BUILD_DONE';
  jobId: string;
  artifactName?: string;
}

export interface BuildStatusEvent {
  type: 'BUILD_STATUS';
  jobId: string;
  status: string;
}

/** What the relay is posted: any message of the channel, its type a plain string. */
export interface BuildMessage {
  type: string;
  jobId: string;
}
