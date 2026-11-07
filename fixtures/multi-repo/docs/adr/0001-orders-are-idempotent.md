# 1. Orders are idempotent

## Decision

`POST /orders` returns the order a repeated idempotency key already made, and
`OrdersService.create` publishes `order.created` once per order.

## What it replaced

`POST /cart` took a basket and made the order later; it is gone.
