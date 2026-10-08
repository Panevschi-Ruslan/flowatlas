import { Directive, EventEmitter, Input, Output, input } from '@angular/core';

/**
 * A directive is bound the way a component is (P40): its node says it takes
 * `appHighlight` and `delay`, and gives back `highlighted`.
 */
@Directive({ standalone: true, selector: '[appHighlight]' })
export class HighlightDirective {
  @Input() appHighlight = 'yellow';
  readonly delay = input<number>(0);
  @Output() highlighted = new EventEmitter<boolean>();
}
