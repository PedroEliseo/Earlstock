/** The only capability the health check needs; satisfied by pg's Pool and trivial to fake in tests. */
export interface Queryable {
  query(text: string): Promise<unknown>;
}

export async function isDatabaseReachable(db: Queryable): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch (err) {
    console.error('Database health check failed', err);
    return false;
  }
}
