import Footer from '../../components/Footer';
import Nav from '../../components/Nav';

/** The front page, in the visitor's locale. */
export default function FrontPage() {
  return (
    <main>
      <Nav page={1} />
      <Footer />
    </main>
  );
}
