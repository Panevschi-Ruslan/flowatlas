/** Alerts the members desk: the failure destination of the loans service's card lookup. */
export const handler = async (event: { requestContext: { functionArn: string } }): Promise<void> => {
  console.log('failed', event.requestContext.functionArn);
};
