import { Component } from '@angular/core';

/** `/analytics`, behind both guards; none of its code loads items. */
@Component({
  standalone: true,
  selector: 'app-analytics',
  template: `<h1>Analytics</h1>`,
})
export class AnalyticsComponent {}
