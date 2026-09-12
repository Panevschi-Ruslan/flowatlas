/** Function middleware — applied through consumer.apply() in AppModule. */
export function requestIdMiddleware(
  request: unknown,
  response: unknown,
  next: () => void,
): void {
  void request;
  void response;
  next();
}
