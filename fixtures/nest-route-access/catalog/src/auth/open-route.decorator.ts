import { applyDecorators, Header } from '@nestjs/common';

import { Public } from './public.decorator';

/** A decorator of the project's own that wraps `@Public()` with a header: read through. */
export const OpenRoute = () => applyDecorators(Public(), Header('Cache-Control', 'public, max-age=60'));
