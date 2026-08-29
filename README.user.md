# Quadlet Manager

Ce dossier contient les fichiers Quadlet utilisés par Podman et systemd en mode rootless.

## Fonctionnement

- Les fichiers .container décrivent des conteneurs Podman.
- Les fichiers .pod décrivent des pods Podman.
- Les fichiers .kube décrivent des applications Kubernetes.
- Les unités sont gérées par le systemd utilisateur.

## Utilisation

Dans l'extension Quadlet Manager, vous pouvez créer, modifier, démarrer, arrêter et supprimer les fichiers Quadlet. Le bouton Update all recharge les unités utilisateur, lance podman auto-update, puis nettoie les images inutilisées.

Après une modification, utilisez Enregistrer et redémarrer pour appliquer la nouvelle configuration d'un fichier .container.
