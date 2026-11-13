import type { Pool } from 'pg';
import type { Page, Pagination } from '../../shared/http/pagination.js';

export interface Stock {
  id: string;
  ticker: string;
  createdAt: Date;
}

// A constant, never user input. Aliases map snake_case columns onto the Stock shape.
const STOCK_COLUMNS = 'id, ticker, created_at AS "createdAt"';

/**
 * Read-only SQL for the stocks table; the data importer is the only writer. Every value is passed
 * as a bound parameter ($1, $2, ...).
 */
export function createStocksRepository(db: Pool) {
  return {
    /** Ordered by ticker (byte-wise "C" collation), which is unique, so pages are stable. */
    async findPage({ limit, offset }: Pagination): Promise<Page<Stock>> {
      const [items, count] = await Promise.all([
        db.query<Stock>(`SELECT ${STOCK_COLUMNS} FROM stocks ORDER BY ticker LIMIT $1 OFFSET $2`, [
          limit,
          offset,
        ]),
        db.query<{ total: number }>('SELECT count(*)::int AS total FROM stocks'),
      ]);
      return { items: items.rows, total: count.rows[0]?.total ?? 0 };
    },

    async findById(id: string): Promise<Stock | null> {
      const { rows } = await db.query<Stock>(`SELECT ${STOCK_COLUMNS} FROM stocks WHERE id = $1`, [
        id,
      ]);
      return rows[0] ?? null;
    },
  };
}

export type StocksRepository = ReturnType<typeof createStocksRepository>;
