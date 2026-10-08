/** What the routes read and answer. Declared once, imported by the routes. */
export interface CreateOrder {
  customerId: string;
  total: number;
  note?: string;
}

export interface Order {
  id: string;
  customerId: string;
  total: number;
}

export interface ImportedOrders {
  source: string;
  count: number;
}

export interface Problem {
  message: string;
}
