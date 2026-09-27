/**
 * A helper the API's own tests use. It is a devDependency of the service
 * itself, so it stays in the service's extent, and the setting it reads is the
 * evidence that the file was walked.
 */
export const apiUnderTest = (): string => process.env.E2E_API_URL ?? 'http://localhost:3000';
