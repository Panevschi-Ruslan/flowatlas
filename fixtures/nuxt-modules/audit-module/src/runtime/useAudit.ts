export const useAudit = () => {
  const record = (what: string) => $fetch('/api/audit', { method: 'POST', body: { what } });
  return { record };
};
