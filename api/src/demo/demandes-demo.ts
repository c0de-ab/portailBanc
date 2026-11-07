import type { Role, UtilisateurSession } from '../auth/utilisateur-session';
import { BanqueService } from '../banque/banque.service';
import type { BaseService } from '../base/base.service';
import { ActivationService } from '../demandes/activation.service';
import { DemandesClientService } from '../demandes/demandes-client.service';
import { DossiersService } from '../demandes/dossiers.service';
import { SoumissionService } from '../demandes/soumission.service';
import { HistoriqueService } from '../historique/historique.service';

// Les demandes de démonstration, créées PAR LES SERVICES MÉTIER et
// non par des insertions directes : elles suivent le vrai parcours, et leur historique est
// identique à celui d'une demande créée dans l'application.
// - Mehdi : 40 000 DH, soumise, en attente de Karim (scénario 3 : Karim sera refusé, R8).
// - Inès : 45 000 DH, soumise puis recommandée par Salma, en attente de l'équipe B (R14).
// Idempotent : un client qui a déjà une demande n'en reçoit pas d'autre.
export async function creerDemandesDemo(base: BaseService, maintenant: Date): Promise<string[]> {
  const historique = new HistoriqueService(base);
  const clients = new DemandesClientService(base, historique);
  const soumission = new SoumissionService(base, historique);
  const activation = new ActivationService(base, historique, new BanqueService(base));
  const dossiers = new DossiersService(base, historique, activation);
  const creees: string[] = [];

  // Un client de démonstration soumet une demande, s'il n'en a encore aucune.
  async function soumettre(email: string, plafondDemande: number, motif: string) {
    const client = await utilisateur(base, email);
    const existantes = await base.requete('SELECT 1 FROM requests WHERE client_id = $1', [
      client.clientId,
    ]);
    if (existantes.rowCount !== 0) {
      return null;
    }
    const [compte] = await clients.comptes(client);
    const { demande } = await clients.obtenirBrouillon(client, compte.id, maintenant);
    const remplie = await clients.modifier(
      client,
      demande.id,
      demande.version,
      { plafondDemande, dureeJours: 3, motif },
      maintenant,
    );
    return soumission.soumettre(
      client,
      demande.id,
      { version: remplie.demande.version, plafondDemande, dureeJours: 3 },
      maintenant,
    );
  }

  const mehdi = await soumettre(
    'client.mehdi@portail.test',
    40_000,
    'Achat de matériel professionnel',
  );
  if (mehdi) {
    creees.push(`Mehdi (${mehdi.reference})`);
  }

  const ines = await soumettre('client.ines@portail.test', 45_000, 'Travaux dans le logement');
  if (ines) {
    const salma = await utilisateur(base, 'conseiller.salma@portail.test');
    await dossiers.decider(
      salma,
      ines.id,
      'recommander',
      ines.version,
      'Revenus réguliers, historique du compte sans incident.',
      maintenant,
      'FAVORABLE',
    );
    creees.push(`Inès (${ines.reference})`);
  }

  return creees;
}

// L'utilisateur tel que la session le connaîtrait après sa connexion.
async function utilisateur(base: BaseService, email: string): Promise<UtilisateurSession> {
  const { rows } = await base.requete<{
    id: string;
    display_name: string;
    roles: Role[];
    team_id: string | null;
    client_id: string | null;
  }>(
    `SELECT u.id, u.display_name, u.roles::text[] AS roles, u.team_id, c.id AS client_id
       FROM users u LEFT JOIN clients c ON c.user_id = u.id
      WHERE u.email = $1`,
    [email],
  );
  const ligne = rows[0];
  return {
    id: ligne.id,
    displayName: ligne.display_name,
    roles: ligne.roles,
    teamId: ligne.team_id,
    clientId: ligne.client_id,
  };
}
