# tables-set-elsewhere

Tables written down one step away from the query, read without configuration
(P88). A recipe-sharing app in two services: `recipes-api` on the MongoDB
driver, `ratings-api` on TypeORM. No `adapters.db` configuration at all.

| Call | Expected table | Why |
|---|---|---|
| `this.recipesRepository.findAll()` | `recipes`, read, static, `tableFrom: inferred-property` | `BaseRepository` hands `this.collectionName` to the driver's `collection(...)`, so its classes name their table there; `RecipesRepository` sets it to a constant on a `readonly` field |
| `this.recipesRepository.findPopular()` | `recipes`, read | a finder the subclass declares, through the same base |
| `this.tagsRepository.findAll()` | `tags`, read, **heuristic** | the field is not `readonly`, so another assignment could change it |
| `this.cookbooksRepository.findAll()` / `findLatest()` | `cookbooks`, read | two levels of bases; the second base's own query reads the same field |
| `this.draftsRepository.findAll()` | none; one `dynamic-table-name` row naming `DraftsRepository` | the field is set from settings at run time |
| the queries inside `BaseRepository` and `TimestampedRepository` | none; one folded `info` row | they run for every class extending them |
| `this.coll().insertOne(...)` in `CommentsStore` | `comments`, write, `tableFrom: helper` | a private helper whose one return is `collection(COMMENTS)` |
| `this.collection.find(...)` in `CommentsStore` | `comments`, read, `tableFrom: helper` | a getter, read the same way |
| `this.named('comment_flags').insertOne(...)` | none; one `dynamic-table-name` row | the helper's table is its caller's argument |
| `this.searchRepository.lookup(term)` in `RecipesService` | no row; counted as `receiversExplainedByEdge` | the call is drawn as a static edge into `SearchRepository.lookup`, where the query is read |
| `this.em.find(Rating, ...)` | `ratings`, `source: entity-arg` | `@Entity('ratings')` |
| `this.em.createQueryBuilder(Reviewer, 'r')` | `Reviewer` | `@Entity()` states nothing, so the class name |
| `this.em.save(Badge, badge)` | `reviewer_badges`, write | `@Entity({ name: 'reviewer_badges' })` |
| `this.em.createQueryBuilder().select('r').from(Rating, 'r')` | `ratings` | the class named in `from` |
| `this.dataSource.getRepository(Rating).count()` | `ratings`, `source: type-arg` | the repository it hands out is `Repository<Rating>`, read through the same decorator |
| `this.ratings.find()` on `Repository<Rating>` | `ratings` | the type-argument path names the table the way the class argument does |
| `this.em.createQueryBuilder().subQuery()` | none; `dynamic-table-name` | a sub-query names no table |
| `this.em.query('SELECT … ' + where)` | none; `dynamic-table-name` | SQL built at run time |
| `this.reviewsRepository.recent()` through a token typed by an interface | none; `db-receiver-name-only` kept | no edge explains it |
