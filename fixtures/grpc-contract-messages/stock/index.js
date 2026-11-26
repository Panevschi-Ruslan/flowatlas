const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const health = require('grpc-health-check');
const { ReflectionService } = require('@grpc/reflection');

const definition = protoLoader.loadSync('store.proto');
const store = grpc.loadPackageDefinition(definition);

function reserve(call, callback) {
  callback(null, { reservationId: `${call.request.sku}-1`, status: 'HELD' });
}

const server = new grpc.Server();

// Health checking, from a package: the protocol's own contract says its methods.
server.addService(health.service, new health.Implementation({ '': 'SERVING' }));

// Reflection, from a package, added by the package itself.
new ReflectionService(definition).addToServer(server);

// The contract declares CountStock, which nothing here implements, and no
// method `restock`, which is implemented anyway.
server.addService(store.store.InventoryService.service, {
  reserve,
  release: (call, callback) => callback(null, { reservationId: call.request.reservationId, status: 'RELEASED' }),
  restock: (call, callback) => callback(null, {}),
});

server.bindAsync(`0.0.0.0:${process.env.PORT}`, grpc.ServerCredentials.createInsecure(), () => server.start());
