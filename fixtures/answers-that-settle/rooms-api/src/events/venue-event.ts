/** Every type of message the venue tells on its channels. Each is used by member only, where it is sent. */
export enum VenueEvent {
  RowClaimed = 'ROW_CLAIMED',
  CallStaff = 'CALL_STAFF',
  OrderReady = 'ORDER_READY',
  OrderPaid = 'ORDER_PAID',
  TableFreed = 'TABLE_FREED',
  RoomReady = 'ROOM_READY',
}
