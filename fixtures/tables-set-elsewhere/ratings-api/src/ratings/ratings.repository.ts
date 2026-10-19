import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Badge } from './badge.entity.js';
import { Rating } from './rating.entity.js';
import { Reviewer } from './reviewer.entity.js';

/** Queries through the manager, each naming its entity by the class it hands over. */
@Injectable()
export class RatingsRepository {
  constructor(
    private readonly em: EntityManager,
    private readonly dataSource: DataSource,
  ) {}

  // `ratings`, read: the class's decorator names the table.
  topRated(): Promise<Rating[]> {
    return this.em.find(Rating, { order: { stars: 'DESC' } });
  }

  // `Reviewer`, read: a decorator that states nothing leaves the class name.
  reviewersNamed(name: string): Promise<Reviewer[]> {
    return this.em.createQueryBuilder(Reviewer, 'r').where('r.name = :name', { name }).getMany();
  }

  // `ratings`, read, through the repository the data source hands out.
  count(): Promise<number> {
    return this.dataSource.getRepository(Rating).count();
  }

  // `reviewer_badges`, read, through a constant bound to that repository.
  badges(): Promise<Badge[]> {
    const repository = this.dataSource.getRepository(Badge);
    return repository.find();
  }

  // `reviewer_badges`, write.
  award(badge: Partial<Badge>): Promise<Badge> {
    return this.em.save(Badge, badge);
  }

  // `ratings`, read: a builder made without an entity names it in `from`.
  fromBuilder(): Promise<Rating[]> {
    return this.em.createQueryBuilder().select('r').from(Rating, 'r').getMany();
  }

  // A sub-query names no table: a gap.
  nested(): string {
    return this.em.createQueryBuilder().subQuery().select('1').getQuery();
  }

  // SQL built at run time: a gap.
  raw(where: string): Promise<unknown> {
    return this.em.query('SELECT * FROM ratings WHERE ' + where);
  }
}
