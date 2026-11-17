export default ({ env }) => ({
  port: env.int('PORT', 4310),
});
