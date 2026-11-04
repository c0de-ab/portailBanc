import type request from 'supertest';
import type { VueDemandeClient, VueDossier } from '../src/demandes/demande';

// Les actions du parcours, par les vraies routes, pour écrire les tests de scénario lisiblement.
type Http = () => ReturnType<typeof request>;
type ReponseDemande<V> = { demande: V };

export const PDF = Buffer.from('%PDF-1.4\n% justificatif fictif\n');

export function parcours(http: Http) {
  async function compteDe(cookie: string): Promise<string> {
    const reponse = await http().get('/api/comptes').set('Cookie', cookie);
    return (reponse.body as { comptes: { id: string }[] }).comptes[0].id;
  }

  // Le client crée et remplit son brouillon.
  async function brouillon(cookie: string, plafondDemande: number, dureeJours = 3) {
    const compteId = await compteDe(cookie);
    const cree = (await http().post(`/api/comptes/${compteId}/brouillon`).set('Cookie', cookie))
      .body as ReponseDemande<VueDemandeClient>;
    const rempli = await http()
      .patch(`/api/demandes/${cree.demande.id}`)
      .set('Cookie', cookie)
      .send({ version: cree.demande.version, plafondDemande, dureeJours, motif: 'Achat' });
    return (rempli.body as ReponseDemande<VueDemandeClient>).demande;
  }

  async function deposerPdf(cookie: string, demande: VueDemandeClient) {
    const reponse = await http()
      .put(`/api/demandes/${demande.id}/justificatif`)
      .set('Cookie', cookie)
      .field('version', String(demande.version))
      .attach('fichier', PDF, { filename: 'justificatif.pdf', contentType: 'application/pdf' });
    return (reponse.body as ReponseDemande<VueDemandeClient>).demande;
  }

  // Le client confirme exactement ce qu'il voit (R7).
  async function soumettre(cookie: string, demande: VueDemandeClient) {
    const reponse = await http()
      .post(`/api/demandes/${demande.id}/soumettre`)
      .set('Cookie', cookie)
      .send({
        version: demande.version,
        plafondDemande: demande.plafondDemande,
        dureeJours: demande.dureeJours,
      });
    if (reponse.status !== 200) {
      throw new Error(`Soumission refusée : ${reponse.status} ${JSON.stringify(reponse.body)}`);
    }
    return (reponse.body as ReponseDemande<VueDemandeClient>).demande;
  }

  // Une demande soumise, avec un justificatif au-delà de 50 000 DH (R4).
  async function demandeSoumise(cookie: string, plafondDemande: number) {
    let demande = await brouillon(cookie, plafondDemande);
    if (plafondDemande > 50_000) {
      demande = await deposerPdf(cookie, demande);
    }
    return soumettre(cookie, demande);
  }

  // Une décision du personnel. `version` est celle que l'agent a lue.
  function decider(
    cookie: string,
    id: string,
    action: 'demander-complement' | 'approuver' | 'rejeter' | 'recommander',
    version: number,
    motif = 'Motif de la décision',
    avis: 'FAVORABLE' | 'DEFAVORABLE' = 'FAVORABLE',
  ) {
    const corps = action === 'recommander' ? { version, motif, avis } : { version, motif };
    return http().post(`/api/dossiers/${id}/${action}`).set('Cookie', cookie).send(corps);
  }

  async function dossier(cookie: string, id: string) {
    const reponse = await http().get(`/api/dossiers/${id}`).set('Cookie', cookie);
    return reponse.body as {
      demande: VueDossier;
      decisions: { type: string; role: string; acteur: string }[];
      historique: { action: string }[];
      revisions: { revisionNo: number }[];
    };
  }

  return { compteDe, brouillon, deposerPdf, soumettre, demandeSoumise, decider, dossier };
}
