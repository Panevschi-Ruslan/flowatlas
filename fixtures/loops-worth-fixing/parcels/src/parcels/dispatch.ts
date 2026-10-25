import { Injectable } from '@nestjs/common';
import { MongoClient } from 'mongodb';
import { createTransport } from 'nodemailer';

@Injectable()
export class ParcelDispatch {
  private readonly mail = createTransport();

  private readonly db = new MongoClient('mongodb://localhost:27017').db('parcels');

  // A compare-and-set per parcel, with no batch form: a note, per item on purpose.
  async claimAll(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.db.collection('parcels').findOneAndUpdate({ _id: id, status: 'queued' }, { $set: { status: 'claimed' } });
    }
  }

  // One mail per recipient: a note, per item on purpose.
  async notifyAll(recipients: string[]): Promise<void> {
    for (const to of recipients) {
      await this.mail.sendMail({ to, subject: 'Your parcel is on its way' });
    }
  }
}
