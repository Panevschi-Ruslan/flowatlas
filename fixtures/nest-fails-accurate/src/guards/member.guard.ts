import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { MembersService } from '../members/members.service';

/** Says no by returning false: the framework answers that with a 403. */
@Injectable()
export class MemberGuard implements CanActivate {
  constructor(private readonly members: MembersService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return this.members.isMember(request.user);
  }
}
