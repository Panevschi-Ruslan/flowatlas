export interface ProductDto {
  id: string;
  name: string;
  price: number;
  tags?: string[];
}

export interface CreateProductDto {
  name: string;
  price: number;
}

export interface ReviewDto {
  rating: number;
  text: string;
}
