import { useMutation } from 'urql';

import { RenameProductDocument } from '../backend/graphql';
import { getProduct, listProducts, renameProduct, watchProducts } from '../backend/catalog';
import { searchProducts } from '../backend/search';

export const ProductPage = ({ id }: { id: string }) => {
  const [, rename] = useMutation(RenameProductDocument);
  const load = async () => {
    await listProducts(10);
    await getProduct(id);
    await searchProducts(5);
    watchProducts();
  };
  return (
    <div>
      <button onClick={() => void load()}>load</button>
      <button onClick={() => void renameProduct(id, 'cup')}>rename</button>
      <button onClick={() => void rename({ id, title: 'bowl' })}>rename here</button>
    </div>
  );
};
