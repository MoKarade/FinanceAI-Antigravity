# Refonte Épurée de l'Onglet Sauvegarde & Bouclier Zéro Perte de Données

Ce plan simplifie l'onglet **Réglages → Sauvegarde** pour ne conserver que l'essentiel (sans aucune référence à l'ancienne application, ni export manuel, ni verrou MCP) et met en place une architecture de protection continue garantissant qu'aucune manipulation ou bascule en mode test ne puisse altérer votre dossier patrimonial.

## Décisions Confirmées

> [!IMPORTANT]
> Les choix validés lors de la clarification gouvernent le périmètre exact de cette mise à jour :

- **Mécanisme zéro perte de données** : Combinaison de la **Synchronisation Google Drive** et du **Bouclier anti-mode test** (verrouillage automatique du dossier réel avant toute simulation de persona et copie de secours locale dédiée).
- **Périmètre strict de l'onglet Sauvegarde** :
  1. **État du dossier actif et indicateur de protection** (patrimoine net actif, compteurs d'inventaire, statut de persistance navigateur et intégrité du coffre).
  2. **Restauration rapide en cas de bascule en mode test** (bouton d'action immédiat pour rétablir le dossier réel protégé en un clic).
  3. **Carte de synchronisation Google Drive toujours accessible** (affichée en permanence, avec configuration directe si l'identifiant OAuth n'est pas encore renseigné).
- **Éléments retirés** : Suppression complète de toutes les mentions ou outils liés à l'ancienne application (`appDataFolder` legacy, collage JSON brut, import `.bak`/`FAI1`), retrait de la carte `WriteLockCard` (verrou d'écriture MCP), et maintien du retrait de Firebase, des exports JSON/chiffrés et des instantanés locaux.

---

## 1. Vue d'Ensemble & Expérience Utilisateur

- **Objectif** : Offrir une page **Sauvegarde** sobre, lisible en un coup d'œil et centrée sur la continuité automatique des données plutôt que sur des opérations techniques manuelles.
- **Protection transparente au quotidien** :
  - **Niveau 1 — Persistance locale verrouillée** : Chaque mise à jour de votre dossier réel (hors mode test) est enregistrée dans le stockage principal et répliquée dans une empreinte de sécurité isolée.
  - **Niveau 2 — Bouclier anti-mode test** : Dès qu'un profil de démonstration est activé, le bouclier fige votre dossier réel et bloque toute écriture par-dessus. Un bouton de restauration rapide dans l'onglet Sauvegarde permet de revenir instantanément à votre dossier réel (~230 k$).
  - **Niveau 3 — Synchronisation Google Drive** : Synchronisation automatique vers votre espace privé Google Drive à chaque modification et lors de la fermeture de l'onglet.

---

## 2. Architecture Visuelle & Spatiale

L'interface respecte la grille et les variables de thème de l'application (`bg-surface`, `bg-fond`, `border-bordure`, `text-ink-*`) avec une hiérarchie à un seul niveau d'élévation et des cibles tactiles d'au moins `44 px` (`touch-target h-11`) :

```
┌──────────────────────────────────────────────────────────────────────────┐
│  BLOC 1 · ÉTAT DU DOSSIER ACTIF & BOUCLIER ANTI-MODE TEST                │
│                                                                          │
│  Dossier local actif · 229 741 $          [ Retrouver mon dossier réel ] │
│  Protection automatique active                                           │
│                                                                          │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────┐  │
│  │ 1. Inventaire du dossier         │  │ 2. Statut de protection      │  │
│  │ Transactions · Actifs · Dettes   │  │ Bouclier mode test : Actif   │  │
│  │ Police tabulaire (font-mono)     │  │ Clés API : Coffre chiffré    │  │
│  └──────────────────────────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  BLOC 2 · SYNCHRONISATION GOOGLE DRIVE                                   │
│                                                                          │
│  Synchronisation automatique entre vos appareils                         │
│  [ Connecter Google Drive ] / [ Sauvegarder maintenant · Restaurer ]     │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Architecture du Bouclier Zéro Perte de Données

```
┌───────────────────────────┐
│ Modification du dossier   │
│ (Transactions, Actifs…)   │
└─────────────┬─────────────┘
              │
              ▼
    ┌───────────────────┐         OUI (Persona de démo)
    │ Mode test actif ? ├────────────────────────────────────┐
    └─────────┬─────────┘                                    │
              │ NON (Dossier réel)                           ▼
              ▼                                  ┌───────────────────────┐
┌───────────────────────────┐                    │ Écriture isolée en    │
│ 1. Sauvegarde Zustand     │                    │ mémoire temporaire    │
│ 2. Empreinte protégée     │                    │ (Dossier réel intact) │
│ 3. Sync auto Google Drive │                    └───────────────────────┘
└───────────────────────────┘
```

### Garanties techniques contre toute perte future
1. **Empreinte de sécurité hors mode test** : Tant que `isTestMode` est inactif et que le dossier contient des données réelles valides (sans propriété fictive gonflée), une copie de secours dédiée est maintenue automatiquement dans le stockage persistant de l'appareil.
2. **Isolation stricte des personas de test** : L'activation d'un profil de démonstration ne peut jamais écraser l'empreinte de sécurité réelle, et le bouton de restauration rapide rétablit immédiatement cette empreinte propre tout en désactivant le mode test.
3. **Carte Google Drive toujours visible** : Si le client OAuth Google Drive est configuré, la carte propose directement la connexion et la synchronisation en un clic ; s'il n'est pas encore renseigné, la carte reste visible et permet d'activer la connexion sans masquer la fonctionnalité.
