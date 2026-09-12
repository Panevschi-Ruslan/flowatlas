import { Injectable } from '@nestjs/common';
import { SceneEnter } from 'nestjs-telegraf';

/** The class has no @Scene, so this handler never runs. Reported, not dropped. */
@Injectable()
export class NotificationsService {
  @SceneEnter()
  onEnter(): string {
    return 'never called';
  }
}
