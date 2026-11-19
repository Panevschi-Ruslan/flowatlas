export interface Customer {
  id: string;
  name: string;
  email: string;
}

const customers = new Map<string, Customer>();

export const customerById = (id: string): Customer | undefined => customers.get(id);
