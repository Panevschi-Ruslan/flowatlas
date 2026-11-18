import { useEffect } from 'react';
import { account, levels } from './account';

export function Profile() {
  useEffect(() => {
    account.get('/profile');
    levels.get('/levels');
  }, []);
  return <aside />;
}
