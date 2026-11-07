import { Component, type ReactNode } from 'react';

// Le filet de sécurité de l'interface : une erreur pendant l'affichage d'une page (une donnée
// inattendue, par exemple) montre un message et un moyen de repartir, au lieu d'un écran blanc.
// React n'offre ce mécanisme qu'avec un composant de classe.
export class ErreurAffichage extends Component<{ children: ReactNode }, { erreur: boolean }> {
  state = { erreur: false };

  static getDerivedStateFromError() {
    return { erreur: true };
  }

  render() {
    if (!this.state.erreur) {
      return this.props.children;
    }
    return (
      <main className="erreur-affichage" role="alert">
        <h1 className="h2">Cette page n’a pas pu s’afficher.</h1>
        <p className="muted">
          Vos données ne sont pas touchées. Rechargez la page ; si le problème continue, revenez à
          l’accueil.
        </p>
        <a className="btn btn-primaire aligne-debut" href="/">
          Revenir à l’accueil
        </a>
      </main>
    );
  }
}
