const HANDLERS = 'src/accounts';

const join = {
  handler: `${HANDLERS}/join.handler`,
  events: [{ httpApi: { method: 'post', path: '/members' } }],
};

const lapse = {
  handler: `${HANDLERS}/lapse.handler`,
  events: [{ sns: { arn: { Ref: 'LapsedTopic' }, topicName: '${self:service}-${sls:stage}-lapsed' } }],
};

/** Every function of the service, by key. */
export const functions = {
  join,
  lapse,
  renew: { handler: `${HANDLERS}/renew.handler`, events: [{ httpApi: 'PUT /members/{id}/renewal' }] },
};
