/** Lets an editor change the plugin's settings. */
export default (policyContext) => policyContext.state.user?.role === 'editor';
