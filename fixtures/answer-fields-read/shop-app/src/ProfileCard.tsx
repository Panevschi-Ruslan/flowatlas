import { useEffect, useState } from 'react';
import { fetchOrder, fetchProfile, type Profile } from './api';

/** `/profile`: the answer handed to a state's setter, read where the card renders the state. */
export function ProfileCard() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lastOrder, setLastOrder] = useState<string>('');
  useEffect(() => {
    fetchProfile().then(setProfile);
    // Handed whole to a function of the platform: what it reads is not known.
    fetchOrder('last').then((order) => setLastOrder(JSON.stringify(order)));
  }, []);
  return (
    <div>
      <img src={profile?.avatarUrl} />
      <b>{profile?.name}</b>
      <i>{profile?.nickname}</i>
      <pre>{lastOrder}</pre>
    </div>
  );
}
