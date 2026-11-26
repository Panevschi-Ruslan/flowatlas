import { styled } from '@linaria/react';
import { LangLink } from '../i18n/LangLink';
import { Button } from './Button';

const FooterLink = styled(LangLink)`
  color: inherit;
`;

/** The links at the foot of every page. */
export default function Footer() {
  return (
    <footer>
      <FooterLink href="/pricing">Pricing</FooterLink>
      <LangLink href="/fr">Français</LangLink>
      <Button href="/partners">Find a partner</Button>
    </footer>
  );
}
