import { Module } from '@nestjs/common';

import { LibrarianAuth } from './auth/librarian-auth';
import { CatalogueController } from './catalogue/catalogue.controller';
import { CatalogueService } from './catalogue/catalogue.service';
import { DeskController } from './desk/desk.controller';
import { LoansService } from './desk/loans.service';
import { OpeningHoursController } from './hours/opening-hours.controller';

/** No guard anywhere: every check of who is asking is written in a handler. */
@Module({
  controllers: [DeskController, OpeningHoursController, CatalogueController],
  providers: [LibrarianAuth, LoansService, CatalogueService],
})
export class AppModule {}
