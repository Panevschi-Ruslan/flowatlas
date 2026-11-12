import { answerFromRecords } from './records';

/** Answers the queries of the records each shop defines, built when the shop is loaded rather than declared. */
export const useRecordQueries = () => ({
  onRequest: async ({ request, endResponse }: { request: Request; endResponse: (response: Response) => void }) => {
    const answer = await answerFromRecords(request);
    if (answer !== undefined) endResponse(answer);
  },
});
