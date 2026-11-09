/**
 * The one place the browser makes a request. It takes the request as one
 * object and takes its members out where the parameter is written, each with
 * the default a caller that leaves it out gets: the address and the verb are
 * only known at each caller, `request({ url: '/api/basket', method: 'POST' })`.
 */
interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: object;
  queryParams?: Record<string, string>;
}

const request = async <T>({ url = '', method = 'GET', body, queryParams = {} }: RequestOptions): Promise<T> => {
  const response = await fetch(`${url}?${new URLSearchParams(queryParams).toString()}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'content-type': 'application/json' },
  });
  return (await response.json()) as T;
};

export default request;
