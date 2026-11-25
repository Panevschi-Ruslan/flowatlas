/** The daily report as the ops screen reads it: a total no handler declares. */
export interface ReportAnswer {
  data: { date: string; revenue: number };
}

export async function reportLine(): Promise<string> {
  const response = await fetch(`${import.meta.env.VITE_CATALOG_URL}/reports/daily`);
  const body: ReportAnswer = await response.json();
  return `${body.data.date}: ${body.data.revenue}`;
}
