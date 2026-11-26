import { Injectable } from '@nestjs/common';

import type { MemberJoined } from './space-events';

/** Marks a method as the handler of one type; a registry finds it by reflection when the code runs. */
export const OnSpaceEvent =
  (type: string): MethodDecorator =>
  () =>
    undefined;

@Injectable()
export class WelcomeHandlers {
  @OnSpaceEvent('MEMBER_JOINED')
  greet(event: MemberJoined): void {
    void event.memberId;
  }
}

/** Handlers by type, filled from the decorators when the application starts. */
@Injectable()
export class HandlerRegistry {
  private readonly byType = new Map<string, (event: unknown) => void>();

  find(type: string): ((event: unknown) => void) | undefined {
    return this.byType.get(type);
  }
}
