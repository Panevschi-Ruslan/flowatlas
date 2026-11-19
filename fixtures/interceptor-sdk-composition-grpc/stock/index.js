const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// The loader keeps the contract's own field names: `product_id`, not `productId`.
const definition = protoLoader.loadSync('stock.proto', { keepCase: true, longs: String });
const stock = grpc.loadPackageDefinition(definition);

function reserve(call, callback) {
  callback(null, { reservation_id: `${call.request.product_id}-1` });
}

const server = new grpc.Server();
server.addService(stock.stock.StockService.service, { reserve });
server.bindAsync(`0.0.0.0:${process.env.PORT}`, grpc.ServerCredentials.createInsecure(), () => server.start());
