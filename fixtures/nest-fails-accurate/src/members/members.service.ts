import { Injectable } from '@nestjs/common';

@Injectable()
export class MembersService {
  private readonly members = new Set<string>(['m-1']);

  isMember(user: { id: string } | undefined): boolean {
    return user !== undefined && this.members.has(user.id);
  }
}
