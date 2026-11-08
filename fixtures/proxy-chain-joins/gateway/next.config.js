/** @type {import("next").NextConfig} */
module.exports = {
  async rewrites() {
    return [
      { source: '/orders/:path*', destination: `${process.env.ORDERS_URL}/orders/:path*` },
    ];
  },
};
