interface NoticeRequest {
  borrowerId: string;
  notice: string;
}

const subjectOf = (notice: string): string => `Lending library: ${notice.replace(/-/g, ' ')}`;

export const handler = async (event: NoticeRequest): Promise<{ subject: string }> => ({
  subject: subjectOf(event.notice),
});
