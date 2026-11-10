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
 * Tolerant on purpose. What names a way in is read - the package, each
 * service and each of its methods, with the messages it takes and answers and
 * whether either is a stream - and what those messages hold (P287): each
 * message's fields, nested messages and enums, maps, `repeated` and `oneof`.
 * Everything else (options, extensions, reserved ranges, groups) is stepped
 * over by its braces or its semicolon.
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

/** One field of a message: `repeated Item items = 1;`, `map<string, int32> counts = 2;`. */
export interface ProtoField {
  /** As declared, `user_id`. */
  readonly name: string;
  /** The type as written: a scalar, `Item`, `.shop.Item`; a map's value type for a map. */
  readonly type: string;
  readonly repeated: boolean;
  /** A map's key type, where the field is a map. */
  readonly mapKey?: string;
  /** `optional` or `required` where written. */
  readonly label?: 'optional' | 'required';
  /** The `oneof` it is a member of. */
  readonly oneof?: string;
  readonly line: number;
}

/** One message, nested ones named through their parents: `shop.Cart.Item`. */
export interface ProtoMessage {
  readonly name: string;
  readonly fullName: string;
  readonly fields: readonly ProtoField[];
  readonly line: number;
}

/** One enum, and its values' names in the order declared. */
export interface ProtoEnum {
  readonly name: string;
  readonly fullName: string;
  readonly values: readonly string[];
  readonly line: number;
}

/** What one file declares that a way in is named by. */
export interface ProtoFile {
  /** The `package` statement, where there is one. */
  readonly package?: string;
  /** `proto2`, `proto3`, or `editions` for a file that names an edition; absent where unsaid (proto2). */
  readonly syntax?: 'proto2' | 'proto3' | 'editions';
  /** The files it imports, as written. */
  readonly imports: readonly string[];
  readonly services: readonly ProtoService[];
  /** Every message, nested ones included. */
  readonly messages: readonly ProtoMessage[];
  /** Every enum, nested ones included. */
  readonly enums: readonly ProtoEnum[];
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
  let syntax: ProtoFile['syntax'];
  const imports: string[] = [];
  const services: ProtoService[] = [];
  const messages: ProtoMessage[] = [];
  const enums: ProtoEnum[] = [];
  const qualified = (scope: string | undefined, name: string): string => (scope === undefined || scope === '' ? name : `${scope}.${name}`);

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

  /** Whether this token can be a name: not quoted, not punctuation. */
  const isName = (token: Token | undefined): token is Token => token !== undefined && !token.quoted && !PUNCTUATION.has(token.text);

  /** `enum Name { A = 0; B = 1 [deprecated = true]; option ...; reserved ...; }`, the keyword current. */
  const readEnum = (scope: string | undefined): void => {
    const keyword = tokens[at] as Token;
    at += 1;
    const name = peek();
    if (!isName(name)) return;
    at += 1;
    if (!isWord(peek(), '{')) {
      skipStatement();
      return;
    }
    at += 1;
    const values: string[] = [];
    while (at < tokens.length && !isWord(peek(), '}')) {
      const token = peek() as Token;
      if (isName(token) && isWord(peek(1), '=') && token.text !== 'option') values.push(token.text);
      const before = at;
      skipStatement();
      if (at === before) at += 1;
    }
    if (isWord(peek(), '}')) at += 1;
    enums.push({ name: name.text, fullName: qualified(scope, name.text), values, line: keyword.line });
  };

  /** One field, the current token its first: label, type, name, `=`, number, options, `;`. */
  const readField = (into: ProtoField[], oneof?: string): void => {
    const first = peek() as Token;
    let label: ProtoField['label'];
    let repeated = false;
    if (isWord(first, 'repeated')) repeated = true;
    else if (isWord(first, 'optional')) label = 'optional';
    else if (isWord(first, 'required')) label = 'required';
    if (repeated || label !== undefined) at += 1;
    let type: string | undefined;
    let mapKey: string | undefined;
    if (isWord(peek(), 'map') && isWord(peek(1), '<')) {
      const key = peek(2);
      const value = peek(4);
      if (isName(key) && isWord(peek(3), ',') && isName(value) && isWord(peek(5), '>')) {
        mapKey = key.text;
        type = value.text;
        at += 6;
      }
    } else if (isName(peek())) {
      type = (peek() as Token).text;
      at += 1;
    }
    const name = peek();
    // A proto2 group is a message written in place of a field; stepped over, block and all.
    if (type === undefined || type === 'group' || !isName(name) || !isWord(peek(1), '=')) {
      skipStatement();
      return;
    }
    at += 2;
    into.push({
      name: name.text,
      type,
      repeated: repeated || mapKey !== undefined,
      ...(mapKey === undefined ? {} : { mapKey }),
      ...(label === undefined ? {} : { label }),
      ...(oneof === undefined ? {} : { oneof }),
      line: first.line,
    });
    skipStatement();
  };

  /** `message Name { ... }`, the keyword current; nested messages and enums are named through it. */
  const readMessage = (scope: string | undefined, depth = 0): void => {
    const keyword = tokens[at] as Token;
    at += 1;
    const name = peek();
    if (!isName(name)) return;
    at += 1;
    if (!isWord(peek(), '{')) {
      skipStatement();
      return;
    }
    at += 1;
    const fullName = qualified(scope, name.text);
    const fields: ProtoField[] = [];
    while (at < tokens.length && !isWord(peek(), '}')) {
      const token = peek() as Token;
      const before = at;
      if (isWord(token, 'message') && depth < 32) readMessage(fullName, depth + 1);
      else if (isWord(token, 'enum')) readEnum(fullName);
      else if (isWord(token, 'oneof') && isName(peek(1)) && isWord(peek(2), '{')) {
        const group = (peek(1) as Token).text;
        at += 3;
        while (at < tokens.length && !isWord(peek(), '}')) {
          const inner = at;
          if (isWord(peek(), 'option')) skipStatement();
          else readField(fields, group);
          if (at === inner) at += 1;
        }
        if (isWord(peek(), '}')) at += 1;
      } else if (['option', 'reserved', 'extensions', 'extend', ';'].some((word) => isWord(token, word))) skipStatement();
      else readField(fields);
      if (at === before) at += 1;
    }
    if (isWord(peek(), '}')) at += 1;
    messages.push({ name: name.text, fullName, fields, line: keyword.line });
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
    if (isWord(token, 'message')) {
      readMessage(pkg);
      continue;
    }
    if (isWord(token, 'enum')) {
      readEnum(pkg);
      continue;
    }
    if ((isWord(token, 'syntax') || isWord(token, 'edition')) && isWord(peek(1), '=')) {
      const value = peek(2);
      if (isWord(token, 'edition')) syntax = 'editions';
      else if (value?.quoted === true && (value.text === 'proto2' || value.text === 'proto3')) syntax = value.text;
      skipStatement();
      continue;
    }
    if (isWord(token, ';') || isWord(token, '}')) {
      at += 1;
      continue;
    }
    skipStatement();
  }
  return { ...(pkg === undefined ? {} : { package: pkg }), ...(syntax === undefined ? {} : { syntax }), imports, services, messages, enums };
};
