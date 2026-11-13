import type { Pool } from 'pg';
import type { Page, Pagination } from '../../shared/http/pagination.js';

export interface Stock {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  createdAt: Date;
}

export type NewStock = Omit<Stock, 'id' | 'createdAt'>;

// A constant, never user input. Aliases map snake_case columns onto the Stock shape.
const STOCK_COLUMNS = 'id, symbol, name, exchange, currency, created_at AS "createdAt"';

/** All SQL for the stocks table. Every value is passed as a bound parameter ($1, $2, ...). */
export function createStocksRepository(db: Pool) {
  return {
    async findPage({ limit, offset }: Pagination): Promise<Page<Stock>> {
      const [items, count] = await Promise.all([
        db.query<Stock>(
          `SELECT ${STOCK_COLUMNS} FROM stocks ORDER BY exchange, symbol LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
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

    async create(stock: NewStock): Promise<Stock> {
      const { rows } = await db.query<Stock>(
        `INSERT INTO stocks (symbol, name, exchange, currency)
         VALUES ($1, $2, $3, $4)
         RETURNING ${STOCK_COLUMNS}`,
        [stock.symbol, stock.name, stock.exchange, stock.currency],
      );
      const [created] = rows;
      if (!created) throw new Error('INSERT ... RETURNING returned no row');
      return created;
    },

    /** Returns false when no stock had this id. */
    async deleteById(id: string): Promise<boolean> {
      const { rowCount } = await db.query('DELETE FROM stocks WHERE id = $1', [id]);
      return rowCount === 1;
    },
  };
}

export type StocksRepository = ReturnType<typeof createStocksRepository>;
