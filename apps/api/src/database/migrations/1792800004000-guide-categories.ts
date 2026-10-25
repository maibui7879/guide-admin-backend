import { MigrationInterface, QueryRunner } from 'typeorm';

export class GuideCategories1792800004000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Validate existing history without rewriting immutable editorial snapshots.
    await runner.query(`ALTER TABLE content_revisions ADD CONSTRAINT ck_revisions_category
      CHECK (category IN ('character', 'team', 'boss', 'general', 'beginner', 'combat', 'progression'))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE content_revisions DROP CONSTRAINT ck_revisions_category');
  }
}
