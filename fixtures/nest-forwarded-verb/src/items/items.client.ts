import { Injectable } from '@nestjs/common';
import axios from 'axios';

/**
 * A client that states each request's verb and host itself, and takes only the
 * id from its callers (R161). A request credited to a caller is still the one
 * written here: `PUT` and `DELETE` at api.example.com, with the caller's id
 * filled into the path.
 */
@Injectable()
export class ItemsClient {
  // `reason` is the caller's second argument and is not what this request
  // sends: its body, if any, is in its own settings.
  async replace(id: string, reason?: string): Promise<void> {
    await fetch(`https://api.example.com/items/${id}`, { method: 'PUT' });
  }

  // A default, not a verb: the spread after it sends whatever the caller asks
  // for, so the caller's own settings say which verb goes out.
  async send(path: string, init?: RequestInit): Promise<void> {
    await fetch(`https://api.example.com${path}`, { method: 'GET', ...init });
  }

  // Named `get`, as a client method often is. The name of the method a caller
  // calls is not the verb; the verb is the one this request states.
  async get(id: string): Promise<unknown> {
    return axios.delete(`https://api.example.com/items/${id}`);
  }
}
