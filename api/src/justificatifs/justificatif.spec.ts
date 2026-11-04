import { cheminDe, detecterType, nomAffichable } from './justificatif';

describe('detecterType : le type réel, lu sur les premiers octets', () => {
  it.each([
    ['un PDF', Buffer.from('%PDF-1.7\n'), 'pdf'],
    ['un PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), 'png'],
    ['un JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), 'jpg'],
  ])('reconnaît %s', (_cas, contenu, attendu) => {
    expect(detecterType(contenu)).toBe(attendu);
  });

  it.each([
    ['un texte', Buffer.from('bonjour')],
    ['un fichier vide', Buffer.alloc(0)],
    ['un faux PDF qui commence presque bien', Buffer.from('%PD')],
    ['un exécutable', Buffer.from('MZ\x90\x00')],
  ])('refuse %s', (_cas, contenu) => {
    expect(detecterType(contenu)).toBeNull();
  });
});

describe('nomAffichable : le nom d’origine, réduit à un texte d’affichage', () => {
  it.each([
    ['facture.pdf', 'facture.pdf'],
    ['../../config.env', 'config.env'],
    ['C:\\Windows\\system32\\piege.pdf', 'piege.pdf'],
    ['rib\u0000\u001f\u007f.pdf', 'rib.pdf'],
    ['   ', 'justificatif'],
    ['../', 'justificatif'],
  ])('%j -> %j', (nom, attendu) => {
    expect(nomAffichable(nom)).toBe(attendu);
  });

  it('ne dépasse pas 255 caractères', () => {
    expect(nomAffichable(`${'a'.repeat(300)}.pdf`)).toHaveLength(255);
  });
});

describe('cheminDe : seul un nom généré par le serveur désigne un fichier', () => {
  it('accepte uuid + extension', () => {
    expect(cheminDe('3f2c1b9a-8d7e-4c6b-a5f4-e3d2c1b0a9f8.pdf')).toMatch(
      /3f2c1b9a-8d7e-4c6b-a5f4-e3d2c1b0a9f8\.pdf$/,
    );
  });

  it.each(['../secret.pdf', 'facture.pdf', '3f2c1b9a-8d7e-4c6b-a5f4-e3d2c1b0a9f8.exe'])(
    'refuse %j',
    (nom) => {
      expect(() => cheminDe(nom)).toThrow();
    },
  );
});
