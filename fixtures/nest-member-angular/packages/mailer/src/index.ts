import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

/** Angular only for its own tests: a devDependency supplies nothing. */
@Injectable({ providedIn: 'root' })
export class MailPreview {
  constructor(private readonly http: HttpClient) {}

  preview(id: string) {
    return this.http.post<{ html: string }>('/send', { id });
  }
}
