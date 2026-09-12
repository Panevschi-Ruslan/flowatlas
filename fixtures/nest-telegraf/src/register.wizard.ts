import { Wizard, WizardStep } from 'nestjs-telegraf';

/** Numbering with a gap: the chain runs 1 to 2 to 4, which is the flow as written. */
@Wizard('register')
export class RegisterWizard {
  @WizardStep(1)
  askName(): string {
    return 'name?';
  }

  @WizardStep(2)
  askPhone(): string {
    return 'phone?';
  }

  @WizardStep(4)
  done(): string {
    return 'registered';
  }
}
