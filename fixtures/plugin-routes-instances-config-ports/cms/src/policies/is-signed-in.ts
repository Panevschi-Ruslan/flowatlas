/** Lets a request through when a user is signed in. */
export default (policyContext) => Boolean(policyContext.state.user);
