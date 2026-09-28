# nest-interface-dispatch

Two classes implement one interface, and each builds its request URL from a
parameter and calls itself through `this` (R158).

`BasecampCalendarService` and `ZohoCalendarService` both implement `Calendar`. A
parameter forwarded through the interface method must reach only the callers
that run that implementation: a call through `this` runs its own class, a call
through the concrete class runs that class, and a call through the interface
could run either, so each implementation keeps its own request there. Before the
fix, one calendar's address was forwarded to the other calendar's calls, the
real request went missing and wrong ones stood in its place.
