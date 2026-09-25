import { DataSource } from 'typeorm';

/** One connection for the module, the way code without a container holds one. */
export const dataSource = new DataSource();
