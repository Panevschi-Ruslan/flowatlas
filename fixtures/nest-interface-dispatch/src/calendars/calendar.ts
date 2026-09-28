/**
 * One interface, several implementations, and a call through the interface
 * that could land in any of them.
 *
 * The shape of cal.com's calendar integrations (R158): every provider
 * implements `deleteEvent(uid)`, builds its own address from `uid`, and calls
 * itself through `this`. A call written against one implementation's method
 * name is not a call of every implementation's method.
 */
export interface Calendar {
  deleteEvent(uid: string): Promise<void>;
  updateEvent(uid: string): Promise<void>;
}
