import { Pool } from 'pg';

export class StockLevelRepository {
  private readonly pool = new Pool();

  async available(sku: string): Promise<number> {
    const result = await this.pool.query<{ stocked: number; reserved: number }>(
      'SELECT stocked, reserved FROM stock_levels WHERE sku = $1',
      [sku],
    );
    return result.rows.reduce((sum, row) => sum + row.stocked - row.reserved, 0);
  }
}
