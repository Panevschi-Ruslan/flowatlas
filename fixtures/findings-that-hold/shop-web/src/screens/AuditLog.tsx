import { useState } from 'react';
import { useShopFeed, useShopStream, type ShopEvent } from '../live/useShopStream';

/**
 * The audit log's handler: an audit entry comes on the shop's events channel,
 * an order on its orders channel, both through the one stream. A refund is
 * published on neither.
 */
export function handleLive(event: ShopEvent): void {
  switch (event.type) {
    case 'AUDIT_ENTRY_CREATED':
      console.log('audit', event.id);
      break;
    case 'ORDER_PLACED':
      console.log('order', event.id);
      break;
    case 'ORDER_REFUNDED':
      console.log('refund', event.id);
      break;
  }
}

export function AuditLog({ shopId }: { shopId: string }) {
  useShopStream(shopId, handleLive);
  return <ul />;
}

/** On the feed, an alert may come through the channel the settings name, which is not read. */
export function handleFeed(event: ShopEvent): void {
  if (event.type === 'ALERT_RAISED') console.log('alert', event.id);
}

export function FeedPanel({ shopId }: { shopId: string }) {
  const [last] = useState<string>('');
  useShopFeed(shopId, handleFeed);
  return <p>{last}</p>;
}
