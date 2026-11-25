import { Injectable } from '@nestjs/common';

export interface Room {
  id: string;
  number: number;
}

@Injectable()
export class RoomDirectory {
  async findRoom(roomId: string): Promise<Room | undefined> {
    return { id: roomId, number: 1 };
  }
}
