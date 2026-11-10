// @vitest-environment jsdom
// Tests du panneau de l'assistant, centrés sur la carte de confirmation (R7) : c'est le seul
// endroit où une conversation avec l'agent peut mener à une soumission, et seulement par le clic
// du client. L'assistant, la session et l'API sont remplacés par des doublures : aucun serveur.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErreurApi } from '../../api';
import type { Echange } from '../../assistant';
import type { CarteConfirmation } from '../../types';
import { PanneauAssistant } from './PanneauAssistant';

// Les doublures, partagées entre les modules remplacés et les tests.
const doublures = vi.hoisted(() => ({
  echanges: [] as Echange[],
  soumettre: vi.fn(),
  donneesModifiees: vi.fn(),
}));

vi.mock('../../assistant', () => ({
  useAssistant: () => ({
    ouvert: true,
    fermer: vi.fn(),
    effacer: vi.fn(),
    echanges: doublures.echanges,
    envoi: false,
    message: '',
    setMessage: vi.fn(),
    envoyer: vi.fn(),
    donneesModifiees: doublures.donneesModifiees,
  }),
}));

vi.mock('../../session', () => ({
  useSession: () => ({ utilisateur: { displayName: 'Amal' } }),
}));

// L'API réelle est gardée (ErreurApi), seule la soumission est remplacée.
vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  api: { soumettre: doublures.soumettre },
}));

const CARTE: CarteConfirmation = {
  demandeId: 'dem-1',
  version: 987654,
  plafondDemande: 25_000,
  dureeJours: 3,
  motif: 'Achat d’une voiture',
  justificatifNom: null,
};

function afficher(echanges: Echange[]) {
  doublures.echanges = echanges;
  return render(
    <MemoryRouter>
      <PanneauAssistant />
    </MemoryRouter>,
  );
}

const avecCarte = () =>
  afficher([{ de: 'agent', elements: [{ type: 'confirmation', carte: CARTE }] }]);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PanneauAssistant : la carte de confirmation', () => {
  it('récapitule la demande sans afficher la version technique (H14)', () => {
    avecCarte();
    const carte = screen.getByRole('region', { name: 'À confirmer par vous' });
    expect(carte.textContent).toContain('Achat d’une voiture');
    expect(carte.textContent).toContain('3 jours');
    expect(carte.textContent).not.toContain('987654');
  });

  it('ne soumet rien tant que le client n’a pas cliqué', () => {
    avecCarte();
    expect(doublures.soumettre).not.toHaveBeenCalled();
  });

  it('soumet par la route du formulaire, avec la version de la carte, au clic du client', async () => {
    doublures.soumettre.mockResolvedValue({ demande: {} });
    avecCarte();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer et soumettre' }));

    expect(await screen.findByText(/Demande soumise/)).toBeTruthy();
    expect(doublures.soumettre).toHaveBeenCalledWith({
      id: 'dem-1',
      version: 987654,
      plafondDemande: 25_000,
      dureeJours: 3,
    });
    expect(doublures.donneesModifiees).toHaveBeenCalledOnce();
  });

  it('explique un conflit (R7) sans prétendre avoir soumis', async () => {
    doublures.soumettre.mockRejectedValue(
      new ErreurApi(409, [{ code: 'R7', message: 'Version périmée.' }]),
    );
    avecCarte();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer et soumettre' }));

    const alerte = await screen.findByRole('alert');
    expect(alerte.textContent).toContain(
      'La demande a changé depuis que cette carte a été préparée',
    );
    expect(screen.queryByText(/Demande soumise/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirmer et soumettre' })).toBeTruthy();
    expect(doublures.donneesModifiees).not.toHaveBeenCalled();
  });
});

describe('PanneauAssistant : les messages du modèle', () => {
  it('affiche une explication contenant du HTML comme du texte, sans l’interpréter', () => {
    const piege = '<img src=x onerror="alert(1)">';
    const { container } = afficher([
      { de: 'agent', elements: [{ type: 'explication', texte: piege }] },
    ]);
    expect(container.querySelector('img')).toBeNull();
    const reponse = screen.getByRole('group', { name: 'Réponse de l’assistant, à vérifier' });
    expect(reponse.textContent).toContain(piege);
  });
});
