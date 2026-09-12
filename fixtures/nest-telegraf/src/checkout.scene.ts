import { On, Scene, SceneEnter, SceneLeave } from 'nestjs-telegraf';

/** `@On('text')` here and in any other scene are two different entry points. */
@Scene('checkout')
export class CheckoutScene {
  @SceneEnter()
  enter(): string {
    return 'welcome';
  }

  @On('text')
  address(): string {
    return 'address taken';
  }

  @SceneLeave()
  leave(): string {
    return 'bye';
  }
}
