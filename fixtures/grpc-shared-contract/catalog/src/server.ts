import { Server, ServerCredentials } from '@grpc/grpc-js';
// Generated from ../proto/shop.proto by `npm run generate`, and not committed.
import { CatalogServiceService } from './gen/shop_grpc_pb';
import { CatalogImpl } from './catalog';

const server = new Server();
server.addService(CatalogServiceService, new CatalogImpl());
server.bindAsync('0.0.0.0:50051', ServerCredentials.createInsecure(), () => server.start());
