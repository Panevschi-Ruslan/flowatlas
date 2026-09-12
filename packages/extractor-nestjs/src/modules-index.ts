import type { ClassDeclaration } from 'ts-morph';

export type ModuleKind = 'static' | 'dynamic' | 'external';

/** One provider entry of a module, in the shape the DI resolver needs. */
export interface ProviderRegistration {
  /** Token as written: a class name, a string literal, or an injection-token identifier. */
  token: string;
  kind: 'class' | 'useClass' | 'useValue' | 'useFactory' | 'useExisting';
  /** Class backing the token, when there is one in this repository. */
  declaration?: ClassDeclaration;
  /** For `useExisting`, the token it points at. */
  alias?: string;
  file: string;
  line: number;
}

export interface ModuleInfo {
  id: string;
  name: string;
  file: string;
  line: number;
  kind: ModuleKind;
  declaration: ClassDeclaration;
  controllers: ClassDeclaration[];
  providers: ProviderRegistration[];
  exports: string[];
  /** Modules imported, resolved where possible. */
  imports: Array<{ id: string; declaration?: ClassDeclaration; kind: ModuleKind; name: string }>;
}

/** Modules of the repository, plus the provider registrations they declare. */
export class ModuleIndex {
  readonly #byDeclaration = new Map<ClassDeclaration, ModuleInfo>();
  /** Token to every registration of it, across all modules. */
  readonly #byToken = new Map<string, ProviderRegistration[]>();
  /** Which module a class belongs to, for `meta.module`. */
  readonly #ownerOf = new Map<ClassDeclaration, string>();

  add(info: ModuleInfo): void {
    this.#byDeclaration.set(info.declaration, info);
    for (const provider of info.providers) {
      const existing = this.#byToken.get(provider.token);
      if (existing === undefined) this.#byToken.set(provider.token, [provider]);
      else existing.push(provider);
      if (provider.declaration !== undefined) {
        this.#ownerOf.set(provider.declaration, info.name);
      }
    }
    for (const controller of info.controllers) this.#ownerOf.set(controller, info.name);
  }

  get(declaration: ClassDeclaration): ModuleInfo | undefined {
    return this.#byDeclaration.get(declaration);
  }

  all(): readonly ModuleInfo[] {
    return [...this.#byDeclaration.values()];
  }

  /** Every registration of a token, anywhere in the repository. */
  registrationsOf(token: string): readonly ProviderRegistration[] {
    return this.#byToken.get(token) ?? [];
  }

  /** Name of the module that declares a class, when one does. */
  moduleOf(declaration: ClassDeclaration): string | undefined {
    return this.#ownerOf.get(declaration);
  }
}
