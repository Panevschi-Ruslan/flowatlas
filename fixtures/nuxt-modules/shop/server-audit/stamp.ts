export default defineEventHandler((event) => {
  stampRequest(event.path);
});
