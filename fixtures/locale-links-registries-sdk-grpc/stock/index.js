const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// The loader's default: the fields are handed in camelCase, `productId`.
const definition = protoLoader.loadSync('stock.proto', { longs: String });
const stock = grpc.loadPackageDefinition(definition);

function getLevel(call, callback) {
  const { warehouseId } = call.request;
  // Read in the contract's case, which this loader does not hand.
  const product = call.request.product_id;
  // A field the message does not declare at all.
  const zone = call.request.zone;
  callback(null, { unitsLeft: product === undefined ? 0 : warehouseId, backOrder: zone !== undefined });
}

const server = new grpc.Server();
server.addService(stock.stock.StockService.service, { getLevel });
server.bindAsync(`0.0.0.0:${process.env.PORT}`, grpc.ServerCredentials.createInsecure(), () => server.start());
