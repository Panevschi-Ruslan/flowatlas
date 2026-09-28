import { Component } from '@angular/core';

/**
 * Every link under test, and two bindings that name nothing on this class.
 *
 * `hide` is bound by the `let-` attribute on the template around it and `dialog`
 * by the `#dialog` on the element: both are names of the template, so neither is
 * a method this component forgot to declare. `rename()` is one it did.
 */
@Component({
  selector: 'app-shell',
  template: `
    <a routerLink="/home">home</a>
    <a routerLink="/admin/settings">settings</a>
    <a routerLink="/admin/settings/plugins">plugins</a>
    <a routerLink="/admin/reports/weekly">reports</a>
    <a routerLink="/nowhere">nowhere</a>
    <ng-template #dialog let-hide="close">
      <button (click)="hide()">close</button>
    </ng-template>
    <button (click)="dialog.open()">open</button>
    <button (click)="rename()">rename</button>
  `,
})
export class ShellComponent {}
