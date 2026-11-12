/** @type {import("next").NextConfig} */
module.exports = {
  async rewrites() {
    return [
      { source: '/shop-api/:path*', destination: 'http://localhost:3001/:path*' },
      { source: '/old-home', destination: '/' },
    ];
  },
};
