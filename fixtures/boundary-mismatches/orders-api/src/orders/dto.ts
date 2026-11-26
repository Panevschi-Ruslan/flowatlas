import { IsInt, IsString } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  item!: string;

  @IsInt()
  quantity!: number;
}

export class RenameOrderDto {
  @IsString()
  title!: string;
}
