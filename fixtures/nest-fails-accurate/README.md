# nest-fails-accurate fixture

What a route can really answer with (P87): a library-loans API whose
`main.ts` installs a global `ValidationPipe` and a global `DomainErrorFilter`
(`@Catch(DomainError)`, answering `e.status`). Its error classes state their
own status: `LoanNotFound` as a property (404), `LoanOverdue` by handing 409 to
a base that stores it (`this.status = status`), `ShelfLocked` from a getter
(423); `PlainFailure extends Error` states none.

The hand-checked list, which the snapshot must match:

| Route | Fails with |
|---|---|
| `GET /loans` | 403 `ForbiddenException` (`MemberGuard` returns a boolean). No 400: the handler takes nothing. |
| `GET /loans/search` | 403. No 400: `@Query() q: SearchQuery` is an interface. |
| `GET /loans/:id` | 403; 404 `LoanNotFound`. No 400: `@Param('id') id: string` is a primitive. |
| `GET /loans/:id/shelf` | 403; 404 `LoanNotFound`; 423 `ShelfLocked`. |
| `POST /loans` | 400 `BadRequestException` (validation: `@Body() dto: CreateLoanDto` is a class); 401 `UnauthorizedException` thrown by `StaffGuard`, which never returns false and so adds no 403 of its own; 403 from `MemberGuard`; 409 `LoanOverdue` ×2; 500 `PlainFailure` ×2, `assumed` (once through the helper `assertBookId`). |
| `POST /returns/:id` | 400 `LoanNotFound` and 400 `ShelfLocked`: the controller's `@UseFilters(new FixedFilter())` catches everything and answers 400, and is asked before the global filter. |
| `GET /reports/overdue` | 409 `LoanOverdue` and 500 `PlainFailure`, both `assumed`: the controller's `PickedStatusFilter` answers `status(pick(exception))`, which cannot be read, and is a `fails-filter-unread` row. |

The same repository with the global filter taken out of `main.ts` is read in
`packages/cli/src/commands/fails-accurate.test.ts`: there `LoanNotFound`,
`LoanOverdue` and `ShelfLocked` are the framework's 500, `assumed`, with
`declared` keeping 404, 409 and 423.
