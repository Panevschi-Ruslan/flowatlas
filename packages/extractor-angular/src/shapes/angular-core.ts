/**
 * The part of the framework's core an Angular reading asks of the checker.
 *
 * Written by hand against the documented surface, and only as much of it as a
 * reading needs: the class decorators a class is told apart by, the injection
 * points a service is wired through (`inject`, `@Inject`, `@Optional`, a
 * token), and the inputs and outputs a template binds to. Metadata is typed
 * loosely on purpose; its values are read off the source, not the type.
 */
export const ANGULAR_CORE_SHAPE = `
import type { Observable, Subject } from 'rxjs';
export type Type<T> = new (...args: any[]) => T;
export type ProviderToken<T> = Type<T> | InjectionToken<T> | AbstractType<T>;
export interface AbstractType<T> extends Function { prototype: T; }
export declare class InjectionToken<T> {
  constructor(description: string, options?: { providedIn?: unknown; factory?: () => T });
  protected readonly marker: T;
}
export interface ComponentMetadata {
  selector?: string;
  template?: string;
  templateUrl?: string;
  styleUrls?: string[];
  styleUrl?: string;
  standalone?: boolean;
  imports?: unknown[];
  providers?: unknown[];
  host?: Record<string, string>;
  [key: string]: unknown;
}
export interface NgModuleMetadata {
  declarations?: unknown[];
  imports?: unknown[];
  exports?: unknown[];
  providers?: unknown[];
  bootstrap?: unknown[];
}
export interface InjectableMetadata { providedIn?: unknown; }
export declare function Component(metadata: ComponentMetadata): ClassDecorator;
export declare function Directive(metadata?: Record<string, unknown>): ClassDecorator;
export declare function Pipe(metadata: { name: string; standalone?: boolean; pure?: boolean }): ClassDecorator;
export declare function NgModule(metadata?: NgModuleMetadata): ClassDecorator;
export declare function Injectable(metadata?: InjectableMetadata): ClassDecorator;
export declare function Inject(token: unknown): ParameterDecorator;
export declare function Optional(): ParameterDecorator;
export declare function Self(): ParameterDecorator;
export declare function SkipSelf(): ParameterDecorator;
export declare function Host(): ParameterDecorator;
export declare function Input(options?: string | { alias?: string; required?: boolean }): PropertyDecorator;
export declare function Output(alias?: string): PropertyDecorator;
export declare function HostBinding(hostPropertyName?: string): PropertyDecorator;
export declare function HostListener(eventName: string, args?: string[]): MethodDecorator;
export declare function ViewChild(selector: unknown, options?: unknown): PropertyDecorator;
export declare function inject<T>(token: ProviderToken<T>, options?: { optional?: boolean; self?: boolean; skipSelf?: boolean; host?: boolean }): T;
export interface OnInit { ngOnInit(): void; }
export interface OnDestroy { ngOnDestroy(): void; }
export interface OnChanges { ngOnChanges(changes: unknown): void; }
export interface AfterViewInit { ngAfterViewInit(): void; }
export declare class EventEmitter<T> extends Subject<T> {
  constructor(isAsync?: boolean);
  emit(value?: T): void;
}
export interface Signal<T> { (): T; }
export interface WritableSignal<T> extends Signal<T> {
  set(value: T): void;
  update(updateFn: (value: T) => T): void;
  asReadonly(): Signal<T>;
}
export declare function signal<T>(initialValue: T): WritableSignal<T>;
export declare function computed<T>(computation: () => T): Signal<T>;
export declare function effect(effectFn: () => void): unknown;
export interface InputSignal<T> extends Signal<T> {}
export interface OutputEmitterRef<T> { emit(value: T): void; }
export declare const input: {
  <T>(initialValue?: T, options?: { alias?: string }): InputSignal<T>;
  required<T>(options?: { alias?: string }): InputSignal<T>;
};
export declare function output<T = void>(options?: { alias?: string }): OutputEmitterRef<T>;
export declare function toObservable<T>(source: Signal<T>): Observable<T>;
`;
