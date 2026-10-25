import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  GameEntity,
  GameVersionEntity,
  CharacterEntity,
  CharacterAliasEntity,
  CharacterStatEntity,
  SkillEntity,
} from '../entities/catalog.entities';
import { CharacterQuery, PaginationQuery } from '../dto/query.dto';
import { CharacterTalentEntity, CharacterPotentialEntity } from '../entities/progression.entities';

function page<T>(data: T[], total: number, q: PaginationQuery) {
  return {
    data,
    meta: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
  };
}
@Injectable()
export class CatalogService {
  constructor(@Inject(DataSource) private readonly db: DataSource) {}
  async games(q: PaginationQuery) {
    const [rows, total] = await this.db.getRepository(GameEntity).findAndCount({
      where: { status: 'active' },
      order: { name: 'ASC', id: 'ASC' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
    return page(
      rows.map((g) => ({ id: g.id, slug: g.slug, name: g.name, metadata: g.metadata })),
      total,
      q,
    );
  }

  async game(slug: string) {
    const game = await this.db.getRepository(GameEntity).findOneBy({ slug, status: 'active' });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  async versions(gameSlug: string, q: PaginationQuery) {
    const game = await this.game(gameSlug);
    const [rows, total] = await this.db.getRepository(GameVersionEntity).findAndCount({
      where: { gameId: game.id, status: 'published' },
      order: { releaseDate: { direction: 'DESC', nulls: 'LAST' }, id: 'ASC' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
    return page(
      rows.map((v) => ({ id: v.id, version: v.version, releaseDate: v.releaseDate })),
      total,
      q,
    );
  }

  async characters(gameSlug: string, q: CharacterQuery) {
    const game = await this.game(gameSlug);
    const query = this.db
      .getRepository(CharacterEntity)
      .createQueryBuilder('c')
      .where('c.gameId = :gameId AND c.status = :status', { gameId: game.id, status: 'published' });
    if (q.element) query.andWhere('c.element = :element', { element: q.element });
    if (q.rarity) query.andWhere('c.rarity = :rarity', { rarity: q.rarity });
    if (q.role) query.andWhere('c.role = :role', { role: q.role });
    if (q.q) {
      // Escape wildcard syntax: q is a literal substring, never SQL or a pattern.
      const search = `%${q.q.replace(/[\\%_]/g, '\\$&')}%`;
      query.andWhere(
        `(c.name ILIKE :search OR EXISTS (SELECT 1 FROM character_aliases a WHERE a.character_id = c.id AND a.alias ILIKE :search))`,
        { search },
      );
    }

    const [rows, total] = await query
      .orderBy('c.name', 'ASC')
      .addOrderBy('c.id', 'ASC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit)
      .getManyAndCount();
    return page(
      rows.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        element: c.element,
        rarity: c.rarity,
        role: c.role,
        portraitUrl: c.portraitUrl,
      })),
      total,
      q,
    );
  }
  async character(gameSlug: string, slug: string) {
    const game = await this.game(gameSlug);
    const c = await this.db
      .getRepository(CharacterEntity)
      .findOneBy({ gameId: game.id, slug, status: 'published' });
    if (!c) throw new NotFoundException('Character not found');
    const [aliases, stats, skills, talents, potentials] = await Promise.all([
      this.db
        .getRepository(CharacterAliasEntity)
        .find({ where: { characterId: c.id }, order: { position: 'ASC' } }),
      this.db
        .getRepository(CharacterStatEntity)
        .find({ where: { characterId: c.id }, order: { position: 'ASC' } }),
      this.db
        .getRepository(SkillEntity)
        .find({ where: { characterId: c.id }, order: { position: 'ASC' } }),
      this.db
        .getRepository(CharacterTalentEntity)
        .find({ where: { characterId: c.id }, order: { position: 'ASC' } }),
      this.db
        .getRepository(CharacterPotentialEntity)
        .find({ where: { characterId: c.id }, order: { position: 'ASC' } }),
    ]);
    return {
      data: {
        id: c.id,
        slug: c.slug,
        name: c.name,
        element: c.element,
        rarity: c.rarity,
        role: c.role,
        portraitUrl: c.portraitUrl,
        imageUrl: c.imageUrl,
        voice: c.voice,
        mechanicsSchemaVersion: c.mechanicsSchemaVersion,
        mechanics: c.mechanics,
        aliases: aliases.map((a) => a.alias),
        talents: talents.map(({ name, boosts, position }) => ({ name, boosts, position })),
        potentials: potentials.map(
          ({
            sourceId,
            category,
            name,
            description,
            params,
            hiddenParams,
            icon,
            rarity,
            corner,
            position,
          }) => ({
            sourceId,
            category,
            name,
            description,
            params,
            hiddenParams,
            icon,
            rarity,
            corner,
            position,
          }),
        ),
        stats: stats.map((s) => ({
          code: s.code,
          value: s.value,
          level: s.level,
          position: s.position,
        })),
        skills: skills.map((s) => ({
          name: s.name,
          kind: s.kind,
          description: s.description,
          position: s.position,
        })),
        sources: c.sourceUrl ? [{ url: c.sourceUrl, verifiedAt: c.verifiedAt }] : [],
      },
    };
  }
}
