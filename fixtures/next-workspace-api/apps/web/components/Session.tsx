import { send } from '../lib/request';

export function Session() {
  const signIn = () => send('/api/session/login', { email: 'a@example.com' });
  const whoAmI = () => send('/api/session/me', undefined, { method: 'GET' });
  const signOut = () => send('/api/session/logout');
  return (
    <div>
      <button onClick={signIn}>Sign in</button>
      <button onClick={whoAmI}>Who am I</button>
      <button onClick={signOut}>Sign out</button>
    </div>
  );
}
