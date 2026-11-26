import { useEffect, useState } from 'react';

import { officeSdk } from '../client';

export function StaffPage() {
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    void officeSdk()
      .StaffList()
      .then((res) => setNames(res.staff.map((person) => person.name)));
  }, []);
  const signIn = (email: string) => officeSdk().SignIn({ email });
  // An operation no document of the configuration declares.
  const archive = () => officeSdk().ArchiveStaff({ id: '1' });
  return (
    <ul>
      <button onClick={() => void signIn('a@b.c')}>sign in</button>
      <button onClick={() => void archive()}>archive</button>
      {names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  );
}
