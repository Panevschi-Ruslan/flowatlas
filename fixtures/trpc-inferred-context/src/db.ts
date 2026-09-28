import { PrismaClient } from '@prisma/client';

/**
 * The one client, typed by the package it comes from. Nothing is installed, so
 * the checker has no `PrismaClient`; the annotation is what says what this is.
 */
export const prisma: PrismaClient = new PrismaClient();
