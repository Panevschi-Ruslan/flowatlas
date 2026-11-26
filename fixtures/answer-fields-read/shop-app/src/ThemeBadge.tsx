import { useEffect, useState } from 'react';
import { fetchSettings, type Settings } from './api';

/** `/theme`: reads `theme` of an answer whose shape the API does not declare. */
export function ThemeBadge() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    fetchSettings().then(setSettings);
  }, []);
  return <span>{settings?.theme}</span>;
}
