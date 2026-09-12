/** Callback data the inline keyboard sends back, kept in one place. */
export const CB = {
  CANCEL: 'order_cancel',
  CONFIRM: 'order_confirm',
} as const;

/** A key built at run time: nothing static to read, which is the point. */
export const dynamicKey = (): string => `order_${String(Date.now())}`;
