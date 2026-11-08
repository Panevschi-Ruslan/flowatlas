import { Module } from '@nestjs/common';

/** What the shop is built with: written down, so every module it chooses is known. */
export const IN_MEMORY = false;
export const STAGE = 'prod';

/** Counts what the shop does, in production. */
@Module({})
export class MetricsModule {}

/** Sends receipts by mail. */
@Module({})
export class SmtpModule {}

/** Sends nothing. */
@Module({})
export class NullMailModule {}
