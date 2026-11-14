import { Component, inject } from '@angular/core';
// Written by GraphQL Code Generator's apollo-angular plugin, and not committed.
import { DocumentGQL, DocumentsSdk } from '../generated/graphql.js';

/** Edits one document. */
@Component({ selector: 'app-editor', template: '<textarea></textarea>' })
export class EditorComponent {
  saved = true;
  private readonly documentGql = inject(DocumentGQL);

  constructor(private readonly sdk: DocumentsSdk) {}

  list() {
    return this.sdk.documents();
  }

  watchList() {
    return this.sdk.documentsWatch();
  }

  open(id: string) {
    return this.documentGql.fetch({ id });
  }

  save(id: string, body: string) {
    this.saved = true;
    return this.sdk.saveDocument({ id, body });
  }
}
