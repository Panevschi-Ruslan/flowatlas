## Contracts

contracts: edges=30 shared=2 identical=8 drift=20 unchecked=6 errors=14 warnings=5 infos=12 ignored=4

| severity | kind | between | direction | field | what |
|---|---|---|---|---|---|
| error | missing_required | gateway → orders | request | channel | receiver orders requires `channel: string`; sender gateway does not send it |
| error | type_mismatch | orders → gateway | response | total | sender orders sends `total` as `number`; receiver gateway declares it `string` |
| error | type_mismatch | orders → gateway | response | total | sender orders sends `total` as `number`; receiver gateway declares it `string` |
| error | missing_required | orders → gateway | response | title | receiver gateway requires `title: string`; sender orders does not send it; it is on 1 of the 2 shapes this may answer with, and not on LockedDraftDto |
| error | type_mismatch | gateway → orders | request | delivery | sender gateway sends `delivery` as `Delivery`; receiver orders declares it `'post'`; 'courier' is not among the values the receiver accepts |
| error | type_mismatch | gateway → orders | request | placedAt | sender gateway sends `placedAt` as `string`; receiver orders declares it `number` |
| error | missing_required | gateway → orders | request | reference | receiver orders requires `reference: string`; sender gateway does not send it; the sender declares it as holding nothing, and nothing is ever written |
| error | type_mismatch | gateway → orders | request | label | sender gateway sends `label` as `number`; receiver orders declares it `string` |
| error | type_mismatch | gateway → orders | request | next.next.next | sender gateway sends `next.next.next` as `DeepL3`; receiver orders declares it `DeepL3`; their shapes differ below the depth this run compared; raise --depth to see which field |
| error | missing_required | gateway → orders | request | id | receiver orders requires `id: string`; sender gateway does not send it |
| error | missing_required | billing → orders | payload | includeItems | receiver orders requires `includeItems: boolean`; sender billing does not send it |
| error | missing_required | orders → billing | payload | customerId | receiver billing requires `customerId: string`; sender orders does not send it |
| error | missing_required | web → orders | request | shipTo.postcode | receiver orders requires `shipTo.postcode: string`; sender web does not send it |
| error | type_mismatch | orders → web | response | total | sender orders sends `total` as `number`; receiver web declares it `string` |
| warning | extra_field | gateway → orders | request | note | sender gateway sends `note: string`; receiver orders declares no such field; the receiver does not declare it, so its whitelisting validation pipe removes it before the handler reads it |
| warning | extra_field | gateway → orders | request | colour | sender gateway sends `colour: string`; receiver orders declares no such field; the receiver does not declare it, so its whitelisting validation pipe removes it before the handler reads it |
| warning | optionality_mismatch | gateway → orders | request | note | `note` may be left out by sender gateway and is required by receiver orders; the sender marks it optional by question |
| warning | type_mismatch | gateway → orders | request | counts | `counts` is a Set or a Map; JSON carries neither, so what receiver orders reads is whatever a replacer wrote by hand |
| warning | type_mismatch | gateway → orders | request | tags | `tags` is a Set or a Map; JSON carries neither, so what receiver orders reads is whatever a replacer wrote by hand |
| info | extra_field | gateway → orders | request | debugId | the type sender gateway declares permits `debugId: string`; receiver orders declares no such field |
| info | extra_field | gateway → orders | request | archived | the type sender gateway declares permits `archived: boolean`; receiver orders declares no such field |
| info | extra_field | gateway → orders | request | owner | the type sender gateway declares permits `owner: string`; receiver orders declares no such field |
| info | extra_field | gateway → orders | request | archived | sender gateway sends `archived: boolean`; receiver orders declares no such field |
| info | extra_field | gateway → orders | request | extra | sender gateway sends `extra: number`; receiver orders declares no such field |
| info | extra_field | gateway → orders | request | owner | sender gateway sends `owner: string`; receiver orders declares no such field |
| info | extra_field | orders → gateway | response | draft | sender orders sends `draft: type:orders#CreateDraftDto`; receiver gateway declares no such field; on LockedDraftDto, one of the 2 shapes this may answer with |
| info | extra_field | orders → gateway | response | lockedBy | sender orders sends `lockedBy: string`; receiver gateway declares no such field; on LockedDraftDto, one of the 2 shapes this may answer with |
| info | extra_field | gateway → orders | request | internalNote | the type sender gateway declares permits `internalNote: string`; receiver orders declares no such field; the receiver excludes it, so what arrives is thrown away |
| info | extra_field | gateway → orders | request | code | the type sender gateway declares permits `code: string`; receiver orders declares no such field |
| info | extra_field | billing → orders | payload | includeRefunds | sender billing sends `includeRefunds: boolean`; receiver orders declares no such field |
| info | extra_field | gateway → orders | request | note | sender gateway sends `note: string`; receiver orders declares no such field; the receiver does not declare it, so its whitelisting validation pipe removes it before the handler reads it |

### Ignored

| kind | between | field | by |
|---|---|---|---|
| missing_required | gateway → orders | channel | gateway#src/clients/orders.client.ts:OrdersClient.legacy |
| extra_field | gateway → orders | debugId | gateway#src/clients/orders.client.ts:OrdersClient.legacy |
| optionality_mismatch | gateway → orders | note | gateway#src/clients/orders.client.ts:OrdersClient.legacy |
| type_mismatch | orders → gateway | total | gateway#src/clients/orders.client.ts:OrdersClient.legacy |

### Unchecked

| reason | places | what to do |
|---|---|---|
| no-type-on-sender | 4 | Give the handler a return type. A handler that answers with nothing has no contract to check. |
| no-type-on-sender | 2 | Pass a typed value rather than a literal, so there is a declared shape to compare. |

