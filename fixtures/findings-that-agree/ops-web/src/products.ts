/** The product as the ops screen reads it: through the envelope the catalog wraps every answer in. */
export interface ProductAnswer {
  success: boolean;
  data: { id: string; name: string; costPrice: number };
  price?: number;
}

/** Reads the name under `data` (sent), the cost price under `data` (left out by the serializer) and a price at the top (wrapped). */
export async function productLine(id: string): Promise<string> {
  const response = await fetch(`${import.meta.env.VITE_CATALOG_URL}/products/${id}`);
  const body: ProductAnswer = await response.json();
  if (!body.success) return '';
  return `${body.data.name}: cost ${body.data.costPrice}, sold at ${body.price}`;
}
