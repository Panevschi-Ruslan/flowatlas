const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const health = require('grpc-health-check');
const { charge } = require('./charge');

async function chargeHandler(call, callback) {
  try {
    callback(null, await charge(call.request));
  } catch (error) {
    callback(error);
  }
}

// The build copies the shared contract in beside this file.
const shopPackage = grpc.loadPackageDefinition(protoLoader.loadSync('shop.proto'));
const server = new grpc.Server();

server.addService(health.service, new health.Implementation({ '': 'SERVING' }));
server.addService(shopPackage.shop.PaymentService.service, { charge: chargeHandler });

server.bindAsync(`0.0.0.0:${process.env.PAYMENTS_PORT}`, grpc.ServerCredentials.createInsecure(), () => {
  server.start();
});
