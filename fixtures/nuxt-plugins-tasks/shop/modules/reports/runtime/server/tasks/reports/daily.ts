export default defineTask({
  meta: { description: 'The daily report' },
  async run() {
    return { result: 'sent' };
  },
});
