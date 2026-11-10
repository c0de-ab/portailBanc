// @vitest-environment jsdom
// Tests des composants d'affichage : on les affiche dans un faux navigateur (jsdom)
// et on vérifie ce que voit l'utilisateur, comme le ferait un lecteur d'écran.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Frise, Jauge, ListeErreurs } from './composants';
import { uneDemande } from './test/fabriques';

// Vide la page entre deux tests.
afterEach(cleanup);

describe('ListeErreurs', () => {
  it('n’affiche rien sans erreur', () => {
    const { container } = render(<ListeErreurs erreurs={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('affiche toutes les erreurs dans une alerte', () => {
    render(
      <ListeErreurs
        erreurs={[
          { code: 'R1', message: 'Le montant dépasse 100 000 DH.' },
          { code: 'R4', message: 'Un justificatif est requis.' },
        ]}
      />,
    );
    const alerte = screen.getByRole('alert');
    expect(alerte.textContent).toContain('Le montant dépasse 100 000 DH.');
    expect(alerte.textContent).toContain('Un justificatif est requis.');
  });

  it('affiche un message contenant du HTML comme du texte, sans l’interpréter', () => {
    const { container } = render(
      <ListeErreurs erreurs={[{ code: 'X', message: '<img src=x onerror="alert(1)">' }]} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('<img src=x onerror="alert(1)">');
  });
});

describe('Jauge', () => {
  it('décrit le plafond appliqué pour un lecteur d’écran', () => {
    render(<Jauge plafondInitial={10_000} applique={10_000} />);
    const jauge = screen.getByRole('img');
    expect(jauge.getAttribute('aria-label')).toMatch(/^Plafond appliqué : 10\s000 DH/);
  });

  it('décrit aussi le montant demandé quand il y en a un', () => {
    render(<Jauge plafondInitial={10_000} applique={10_000} demande={60_000} />);
    const description = screen.getByRole('img').getAttribute('aria-label') ?? '';
    expect(description).toMatch(/Plafond demandé : 60\s000 DH/);
    expect(screen.getByText('Demandé', { selector: '.bulle' })).toBeTruthy();
  });
});

describe('Frise', () => {
  it('marque l’étape en cours pour un lecteur d’écran', () => {
    render(<Frise demande={uneDemande({ statut: 'SOUMISE' })} />);
    const etapes = screen.getAllByRole('listitem');
    expect(etapes).toHaveLength(5);
    const enCours = etapes.filter((e) => e.getAttribute('aria-current') === 'step');
    expect(enCours).toHaveLength(1);
    expect(enCours[0].textContent).toContain('Examen');
  });

  it('n’affiche rien pour une demande annulée', () => {
    const { container } = render(<Frise demande={uneDemande({ statut: 'ANNULEE' })} />);
    expect(container.innerHTML).toBe('');
  });
});
