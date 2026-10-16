import type { DeclarationShape } from './declaration-shapes.js';

/**
 * The part of the stream library a server hands values back through, and a
 * browser client answers every request with.
 *
 * The one shape more than one reader carries: the library belongs to no
 * framework, so it is held here and each reader lists it beside its own.
 *
 * Written by hand against the library's documented surface, and only as much
 * of it as a reading needs: `Observable<T>` with the `T` the checker unwraps,
 * the subjects a service keeps, and the functions that turn a stream into a
 * promise or back. Operators are typed loosely on purpose — a reading follows
 * what a method returns, and `pipe` keeping the element type is enough for that.
 */
export const RXJS_SHAPE = `
export interface Unsubscribable { unsubscribe(): void; }
export declare class Subscription implements Unsubscribable {
  closed: boolean;
  unsubscribe(): void;
  add(teardown: unknown): void;
}
export interface Observer<T> {
  next: (value: T) => void;
  error: (err: unknown) => void;
  complete: () => void;
}
export type OperatorFunction<T, R> = (source: Observable<T>) => Observable<R>;
export type MonoTypeOperatorFunction<T> = OperatorFunction<T, T>;
export type ObservableInput<T> = Observable<T> | PromiseLike<T> | ArrayLike<T> | Iterable<T>;
export declare class Observable<T> {
  constructor(subscribe?: (subscriber: Subscriber<T>) => unknown);
  subscribe(observer?: Partial<Observer<T>> | ((value: T) => void)): Subscription;
  pipe(): Observable<T>;
  pipe<A>(op1: OperatorFunction<T, A>): Observable<A>;
  pipe<A, B>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>): Observable<B>;
  pipe<A, B, C>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>, op3: OperatorFunction<B, C>): Observable<C>;
  pipe<A, B, C, D>(op1: OperatorFunction<T, A>, op2: OperatorFunction<A, B>, op3: OperatorFunction<B, C>, op4: OperatorFunction<C, D>): Observable<D>;
  pipe(...operations: OperatorFunction<any, any>[]): Observable<unknown>;
}
export declare class Subscriber<T> extends Subscription implements Observer<T> {
  next(value: T): void;
  error(err: unknown): void;
  complete(): void;
}
export declare class Subject<T> extends Observable<T> {
  next(value: T): void;
  error(err: unknown): void;
  complete(): void;
  asObservable(): Observable<T>;
}
export declare class BehaviorSubject<T> extends Subject<T> {
  constructor(value: T);
  getValue(): T;
  readonly value: T;
}
export declare class ReplaySubject<T> extends Subject<T> {
  constructor(bufferSize?: number, windowTime?: number);
}
export declare function of<T>(...values: T[]): Observable<T>;
export declare function from<T>(input: ObservableInput<T>): Observable<T>;
export declare function throwError(factory: () => unknown): Observable<never>;
export declare function firstValueFrom<T>(source: Observable<T>): Promise<T>;
export declare function lastValueFrom<T>(source: Observable<T>): Promise<T>;
export declare function map<T, R>(project: (value: T, index: number) => R): OperatorFunction<T, R>;
export declare function tap<T>(observer?: Partial<Observer<T>> | ((value: T) => void)): MonoTypeOperatorFunction<T>;
export declare function filter<T>(predicate: (value: T, index: number) => boolean): MonoTypeOperatorFunction<T>;
export declare function catchError<T, R>(selector: (err: unknown, caught: Observable<T>) => ObservableInput<R>): OperatorFunction<T, T | R>;
export declare function switchMap<T, R>(project: (value: T, index: number) => ObservableInput<R>): OperatorFunction<T, R>;
export declare function mergeMap<T, R>(project: (value: T, index: number) => ObservableInput<R>): OperatorFunction<T, R>;
export declare function concatMap<T, R>(project: (value: T, index: number) => ObservableInput<R>): OperatorFunction<T, R>;
export declare function take<T>(count: number): MonoTypeOperatorFunction<T>;
export declare function timeout<T>(each: number): MonoTypeOperatorFunction<T>;
export declare function retry<T>(count?: number): MonoTypeOperatorFunction<T>;
`;

/** The stream library's shape, as a reader lists it. */
export const RXJS_DECLARATION_SHAPE: DeclarationShape = Object.freeze({ package: 'rxjs', declarations: RXJS_SHAPE });
