/**
 * How AWS names what it deploys, stated once for every reader that meets it.
 *
 * Code that publishes through the SDK, a state machine definition and the
 * Terraform that deploys both all name the same queue, topic, bus, function or
 * workflow, each in its own way. What they share is the deployed name and the
 * channel a message travels on, and both are spelled here: `deployed` reads a
 * name out of an ARN or a URL, `channels` spells the channel a name is on. The
 * readers are siblings and none may depend on another, so the rule lives in a
 * package each of them can import and none of them owns; it is not in the core
 * because the core names no technology (I1).
 */
export {
  AWS_SERVICE_PREFIX,
  channelOfTarget,
  DEFAULT_EVENT_BUS,
  DEPLOYED_CHANNELS,
  EVENT_NAME_FIELDS,
  eventChannel,
  eventChannelPattern,
  queueChannel,
  topicChannel,
} from './channels.js';
export {
  DEPLOYED_FORMS,
  deployedArn,
  deployedNameIn,
  FUNCTION_NAME_FORMS,
  TABLE_CHANGES_FORMS,
  type DeployedName,
} from './deployed.js';
