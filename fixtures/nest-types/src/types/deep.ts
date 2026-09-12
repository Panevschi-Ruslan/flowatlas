// Depth chain against `types.maxDepth: 3` (flowatlas.config.json).
//
// All five `L*` interfaces are named, so all five are registered in full; only
// the *inline* expansion is cut at the cap. `L0.inline` is an anonymous nested
// object whose innermost level sits below the cap.
//
// unresolved: type-depth-exceeded (info, `meta.level: 'info'`) — emitted once
// per cut site for the anonymous `inline` shape; hint: "raise types.maxDepth".

export interface L4 {
  value: string;
}

export interface L3 {
  next: L4;
}

export interface L2 {
  next: L3;
}

export interface L1 {
  next: L2;
}

export interface L0 {
  next: L1;
  inline: { a: { b: { c: string } } };
}
