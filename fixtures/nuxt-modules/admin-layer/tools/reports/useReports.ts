export const useReports = () => {
  const fetchReport = () => $fetch('/api/reports');
  return { fetchReport };
};
