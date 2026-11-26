import { useQuery } from '@apollo/client';

import { REGIONS } from './queries';

export const RegionPicker = () => {
  const { data } = useQuery(REGIONS);
  return <select>{data?.regions.map((region) => <option key={region}>{region}</option>)}</select>;
};
