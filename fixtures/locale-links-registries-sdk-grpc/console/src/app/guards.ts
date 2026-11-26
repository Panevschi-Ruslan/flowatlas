import { Injectable } from '@angular/core';
import type { EditorComponent } from './editor.component.js';

/** Lets anyone in: the console asks nothing on the way in. */
export const signedIn = () => true;

/** Asks before leaving the admin screens. */
export const leaveAdmin = () => window.confirm('Leave the admin screens?');

/** Keeps the editor open while it holds changes nobody saved. */
@Injectable({ providedIn: 'root' })
export class UnsavedChangesGuard {
  canDeactivate(editor: EditorComponent): boolean {
    return editor.saved || window.confirm('Discard your changes?');
  }
}
