export default ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: 4510,
});
