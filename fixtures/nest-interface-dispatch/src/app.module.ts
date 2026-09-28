import { Module } from '@nestjs/common';
import { BasecampCalendarService } from './calendars/basecamp.service.js';
import { CalendarManagerService } from './calendars/calendar-manager.service.js';
import { ZohoCalendarService } from './calendars/zoho.service.js';

@Module({ providers: [BasecampCalendarService, ZohoCalendarService, CalendarManagerService] })
export class AppModule {}
