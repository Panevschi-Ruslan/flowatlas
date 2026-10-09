import { Directive, EventEmitter, HostBinding, HostListener, Input, Output, input } from '@angular/core';

/**
 * A directive is bound the way a component is (P40): its node says it takes
 * `appHighlight` and `delay`, and gives back `highlighted`. What it binds on its
 * element - the `host` object and its decorated members - and the name a
 * template exports it as are on its node too (P45), and the methods a binding
 * calls are nodes it names (`hostMembers`, P50).
 */
@Directive({
  standalone: true,
  selector: '[appHighlight]',
  exportAs: 'highlight',
  host: { role: 'note', '[attr.aria-live]': 'politeness', '(focus)': 'onFocus()' },
})
export class HighlightDirective {
  @Input() appHighlight = 'yellow';
  readonly delay = input<number>(0);
  @Output() highlighted = new EventEmitter<boolean>();
  politeness = 'polite';

  @HostBinding('class.is-highlighted') active = false;

  @HostListener('mouseenter', ['$event'])
  onEnter(event: MouseEvent): void {
    this.active = event.type === 'mouseenter';
    this.highlighted.emit(this.active);
  }

  onFocus(): void {
    this.active = true;
  }
}
