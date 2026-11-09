export const handler = async (event: { 'detail-type': string; detail: { orderId: string } }) => {
  console.log(`notice for ${event.detail.orderId}: ${event['detail-type']}`);
};
