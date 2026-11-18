const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const entries = [];

function record(call, callback) {
  entries.push({ account: call.request.account, amount: call.request.amount });
  callback(null, { entryId: `e-${entries.length}` });
}

function balance(call, callback) {
  const amount = entries
    .filter((entry) => entry.account === call.request.account)
    .reduce((total, entry) => total + entry.amount, 0);
  callback(null, { amount });
}

// The build copies the shared contract in beside this file.
const books = grpc.loadPackageDefinition(protoLoader.loadSync('ledger.proto'));
const server = new grpc.Server();

server.addService(books.books.LedgerService.service, { record, balance });

server.bindAsync(`0.0.0.0:${process.env.LEDGER_PORT}`, grpc.ServerCredentials.createInsecure(), () => {
  server.start();
});
