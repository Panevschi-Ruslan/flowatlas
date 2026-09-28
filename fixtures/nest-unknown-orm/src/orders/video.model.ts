import { Model, type AttributesOnly } from 'fake-orm';

/**
 * A base class of one's own over the library's model, parameterised by the
 * library's own generic helper.
 *
 * This is how a large project declares a hundred models, and the first type
 * argument of the base is that helper for every one of them.
 */
export class VideoModel extends Model<AttributesOnly<VideoModel>> {
  id: string;
  name: string;
}
