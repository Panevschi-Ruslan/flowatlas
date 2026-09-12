import { IsInt, IsOptional, IsString } from '../../validation';

/** Bound to `@Query() q: ListQuery` → `handles.meta.query`. */
export class ListQuery {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsInt()
  limit?: number;
}
