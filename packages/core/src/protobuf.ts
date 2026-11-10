/**
 * The services a protocol buffer file declares (P274).
 *
 * gRPC is a protocol the core may name, as it names HTTP and GraphQL: what a
 * `.proto` file says is a contract between two services, a fact about the
 * graph's ends rather than about any library either end is written with. The
 * server reader keys a method a server implements by it, the calls reader
 * keys a call a client makes by it, and a document of a service written in
 * another language is one; all three ask this one reading.
 *
 * Tolerant on purpose. Only what names a way in is read - the package, each
 * service and each of its methods, with the messages it takes and answers and
 * whether either is a stream - and everything else (messages, enums, options,
 * extensions, reserved ranges) is stepped over by its braces or its semicolon.
 * A file this does not understand yields the services it could read before the
 * point it stopped understanding, never an exception: a contract half read is
 * still the half that is there, and no reader here can be told to fix it.
 */

/** One method of a service: `rpc GetCart (GetCartRequest) returns (Cart);`. */
export interface ProtoMethod {
  readonly name: string;
  /** The message it takes, as written: `GetCartRequest`, `.shop.GetCartRequest`. */
  readonly request: string;
  /** The message it answers with, as written. */
  readonly response: string;
  readonly requestStream: boolean;
  readonly responseStream: boolean;
  /** 1-based line of the `rpc` keyword. */
  readonly line: number;
}

/** One service: its own name, its name within the package, and its methods. */
export interface ProtoService {
  readonly name: string;
  /** `shop.CartService`, or `CartService` in a file with no package. */
  readonly fullName: string;
  readonly line: number;
  readonly methods: readonly ProtoMethod[];
}

/** What one file declares that a way in is named by. */
export interface ProtoFile {
  /** The `package` statement, where there is one. */
  readonly package?: string;
  /** The files it imports, as written. */
  readonly imports: readonly string[];
  readonly services: readonly ProtoService[];
}

/** How a method is called, in the word a procedure's `meta.call` carries. */
export type GrpcCallKind = 'unary' | 'server-stream' | 'client-stream' | 'bidi-stream';

/** The kind of call a method is, from whether each end streams. */
export const grpcCallKind = (method: Pick<ProtoMethod, 'requestStream' | 'responseStream'>): GrpcCallKind =>
  method.requestStream
    ? method.responseStream
      ? 'bidi-stream'
      : 'client-stream'
    : method.responseStream
      ? 'server-stream'
      : 'unary';

/**
 * The key a gRPC way in is joined on: `grpc:shop.CartService/GetCart`.
 *
 * The part after the prefix is the path a client sends the call to, without
 * its leading slash, so a caller and a server that agree on the wire agree on
 * the key whatever either was written in.
 */
export const grpcEntryKey = (service: string, method: string): string => `grpc:${service}/${method}`;

/**
 * Whether a name written in code is a method's name, the way the libraries
 * match them: `getCart`, `GetCart` and `get_cart` are all `GetCart`, since a
 * generated client lowers the first letter and a loader may keep the case.
 */
export const sameMethodName = (written: string, declared: string): boolean =>
  methodNameKey(written) === methodNameKey(declared);

const methodNameKey = (name: string): string => name.replace(/_/g, '').toLowerCase();

interface Token {
  readonly text: string;
  readonly line: number;
  /** A quoted string, its quotes removed. */
  readonly quoted: boolean;
}

const PUNCTUATION = new Set(['{', '}', '(', ')', ';', '=', '<', '>', ',', '[', ']', ':']);

/** The file as tokens, comments dropped and each token with its line. */
const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  let line = 1;
  let at = 0;
  while (at < text.length) {
    const char = text[at] as string;
    if (char === '\n') {
      line += 1;
      at += 1;
      continue;
    }
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    if (char === '/' && text[at + 1] === '/') {
      while (at < text.length && text[at] !== '\n') at += 1;
      continue;
    }
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let index = at; index < stop; index += 1) if (text[index] === '\n') line += 1;
      at = stop;
      continue;
    }
    if (char === '"' || char === "'") {
      let value = '';
      let index = at + 1;
      while (index < text.length && text[index] !== char && text[index] !== '\n') {
        if (text[index] === '\\' && index + 1 < text.length) {
          value += text[index + 1];
          index += 2;
          continue;
        }
        value += text[index];
        index += 1;
      }
      tokens.push({ text: value, line, quoted: true });
      at = index + 1;
      continue;
    }
    if (PUNCTUATION.has(char)) {
      tokens.push({ text: char, line, quoted: false });
      at += 1;
      continue;
    }
    let end = at;
    while (end < text.length && !/\s/.test(text[end] as string) && !PUNCTUATION.has(text[end] as string) && text[end] !== '"' && text[end] !== "'" && !(text[end] === '/' && (text[end + 1] === '/' || text[end + 1] === '*'))) {
      end += 1;
    }
    if (end === at) end = at + 1;
    tokens.push({ text: text.slice(at, end), line, quoted: false });
    at = end;
  }
  return tokens;
};

/** Reads a file's services; see the module comment for what is stepped over. */
export const parseProto = (text: string): ProtoFile => {
  const tokens = tokenize(text);
  let at = 0;
  let pkg: string | undefined;
  const imports: string[] = [];
  const services: ProtoService[] = [];

  const peek = (offset = 0): Token | undefined => tokens[at + offset];
  const isWord = (token: Token | undefined, word: string): boolean => token !== undefined && !token.quoted && token.text === word;

  /** Past the statement or block starting here: to its `;`, or past its balanced braces. */
  const skipStatement = (): void => {
    while (at < tokens.length) {
      const token = tokens[at] as Token;
      if (isWord(token, ';')) {
        at += 1;
        return;
      }
      if (isWord(token, '{')) {
        skipBlock();
        return;
      }
      // The end of the block around it: left for that block to close.
      if (isWord(token, '}')) return;
      at += 1;
    }
  };

  /** Past a block whose `{` is the current token. */
  const skipBlock = (): void => {
    let depth = 0;
    while (at < tokens.length) {
      const token = tokens[at] as Token;
      at += 1;
      if (isWord(token, '{')) depth += 1;
      else if (isWord(token, '}')) {
        depth -= 1;
        if (depth <= 0) return;
      }
    }
  };

  /** `( stream? Type )`, or nothing where it is not that. */
  const readParenthesised = (): { type: string; stream: boolean } | undefined => {
    if (!isWord(peek(), '(')) return undefined;
    at += 1;
    let stream = false;
    if (isWord(peek(), 'stream') && !isWord(peek(1), ')')) {
      stream = true;
      at += 1;
    }
    const type = peek();
    if (type === undefined || type.quoted || PUNCTUATION.has(type.text)) return undefined;
    at += 1;
    if (!isWord(peek(), ')')) return undefined;
    at += 1;
    return { type: type.text, stream };
  };

  const readService = (): void => {
    const keyword = tokens[at] as Token;
    at += 1;
    const name = peek();
    if (name === undefined || name.quoted || PUNCTUATION.has(name.text)) return;
    at += 1;
    if (!isWord(peek(), '{')) {
      skipStatement();
      return;
    }
    at += 1;
    const methods: ProtoMethod[] = [];
    while (at < tokens.length && !isWord(peek(), '}')) {
      const token = peek() as Token;
      if (!isWord(token, 'rpc')) {
        const before = at;
        skipStatement();
        if (at === before) at += 1;
        continue;
      }
      at += 1;
      const method = peek();
      if (method === undefined || method.quoted || PUNCTUATION.has(method.text)) {
        skipStatement();
        continue;
      }
      at += 1;
      const request = readParenthesised();
      const returns = isWord(peek(), 'returns');
      if (returns) at += 1;
      const response = returns ? readParenthesised() : undefined;
      if (request !== undefined && response !== undefined) {
        methods.push({
          name: method.text,
          request: request.type,
          response: response.type,
          requestStream: request.stream,
          responseStream: response.stream,
          line: token.line,
        });
      }
      // The method's own options in braces, or its semicolon.
      if (isWord(peek(), '{')) skipBlock();
      else if (isWord(peek(), ';')) at += 1;
      else if (request === undefined || response === undefined) skipStatement();
    }
    if (isWord(peek(), '}')) at += 1;
    services.push({
      name: name.text,
      fullName: pkg === undefined ? name.text : `${pkg}.${name.text}`,
      line: keyword.line,
      methods,
    });
  };

  while (at < tokens.length) {
    const token = tokens[at] as Token;
    if (isWord(token, 'package')) {
      const name = peek(1);
      if (name !== undefined && !name.quoted) pkg = name.text;
      at += 1;
      skipStatement();
      continue;
    }
    if (isWord(token, 'import')) {
      at += 1;
      if (isWord(peek(), 'public') || isWord(peek(), 'weak')) at += 1;
      const path = peek();
      if (path?.quoted === true) imports.push(path.text);
      skipStatement();
      continue;
    }
    if (isWord(token, 'service')) {
      readService();
      continue;
    }
    if (isWord(token, ';') || isWord(token, '}')) {
      at += 1;
      continue;
    }
    skipStatement();
  }
  return { ...(pkg === undefined ? {} : { package: pkg }), imports, services };
};
