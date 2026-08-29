
"use strict";

const README_TEMPLATE_PATH = "/home/nico/Documents/quadlet-manager/README.md";

const DISCOVER_SCRIPT = `
for d in /home/*/; do
    u=$(basename "$d")
    uid=$(id -u "$u" 2>/dev/null) || continue
    [ "$uid" -ne 0 ] || continue
    groups="$(id -nG "$u" 2>/dev/null)"
    qdir="\${d}.config/containers/systemd"

    [ -d "$qdir" ] || {
        case " $groups " in
            *" sudo "*|*" sudoers "*|*" wheel "*|*" admin "*)
                ;;
            *)
                printf '__ROOTLESS__\\t%s\\n' "$u"
                ;;
        esac
        continue
    }

    printf '__QUADLET_USER__\\t%s\\n' "$u"

    all_files=()
    all_svcs=()
    valid_files=()
    valid_svcs=()
    shopt -s dotglob
    for f in "$qdir"/*; do
        [ -f "$f" ] || continue
        fname=$(basename "$f")
        uid=$(stat -c '%u' -- "$f")
        gid=$(stat -c '%g' -- "$f")
        base="\${fname%.*}"
        ext="\${fname##*.}"
        case "$ext" in
            container) svc="\${base}.service" ;;
            pod) svc="\${base}-pod.service" ;;
            kube) svc="\${base}.service" ;;
            *) svc="" ;;
        esac
        all_files+=("$fname")
        all_svcs+=("$svc")
        if [ -n "$svc" ]; then
            valid_files+=("$fname")
            valid_svcs+=("$svc")
        fi
    done
    shopt -u dotglob
    declare -A status_map
    if [ \${#valid_svcs[@]} -gt 0 ]; then
        statuses=$(machinectl shell "\${u}@" \
            /usr/bin/env SYSTEMD_COLORS=0 \
            /usr/bin/systemctl --user is-active \
            "\${valid_svcs[@]}" 2>/dev/null)
        i=0
        while IFS= read -r st; do
            status_map["\${valid_files[$i]}"]="$st"
            i=$((i + 1))
        done <<< "$statuses"
    fi
    i=0
    while [ $i -lt \${#all_files[@]} ]; do
        fname="\${all_files[$i]}"
        svc="\${all_svcs[$i]}"
        if [ -n "$svc" ]; then st="\${status_map[$fname]:-unknown}"; else st="n/a"; fi
        uid=$(stat -c '%u' -- "$qdir/$fname")
        gid=$(stat -c '%g' -- "$qdir/$fname")
        printf '%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$u" "$fname" "$svc" "$st" "$uid" "$gid"
        i=$((i + 1))
    done
    unset status_map
done
`;

let currentUser = null;
let currentFile = null;
let currentSvc = null;
let knownUsers = [];
let knownServices = [];
let updateState = {};
let currentFileUid = null;
let currentFileGid = null;
let currentFileMode = null;

const getElement = id => document.getElementById(id);

function isContainerFile(file) {
    return String(file || "").toLowerCase().endsWith(".container");
}

function normalizeStatus(status) {
    return String(status || "").trim().toLowerCase();
}

function createActionButton({
    text,
    className = "file-action-button",
    title = "",
    onClick
}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = text;

    if (title) {
        btn.title = title;
    }

    if (onClick) {
        btn.addEventListener("click", onClick);
    }

    return btn;
}

function createDataCell(text, className = "") {
    const td = document.createElement("td");
    td.textContent = text;

    if (className) {
        td.className = className;
    }

    return td;
}

function runWithSuperuser(args, extraOptions = {}) {
    return cockpit.spawn(args, {
        superuser: "require",
        err: "message",
        ...extraOptions
    });
}

function runScriptWithSuperuser(script, args = []) {
    return cockpit.script(script, args, {
        superuser: "require",
        err: "message"
    });
}

function runAsUser(user, commandArgs) {
    return runWithSuperuser([
        "machinectl",
        "shell",
        `${user}@`,
        ...commandArgs
    ]);
}

function getUserId(user) {
    return runWithSuperuser(["/usr/bin/id", "-u", user])
        .then(output => output.trim());
}

function getUserGid(user) {
    return runWithSuperuser(["/usr/bin/id", "-g", user])
        .then(output => output.trim());
}

/* ============================================================
 * STATUT
 * ============================================================ */

function setStatus(text) {
    getElement("status").textContent = text;
}


/* ============================================================
 * CHARGEMENT
 * ============================================================ */

function loadUsers() {

    setStatus("Chargement...");
    updateState = {};

    cockpit.spawn(
        ["bash", "-c", DISCOVER_SCRIPT],
        {
            superuser: "require",
            err: "message"
        }
    )
    .then(renderUsers)
    .catch(err => {

        setStatus(
            "Erreur : " + err.message
        );

    });
}


/* ============================================================
 * AFFICHAGE
 * ============================================================ */

function parseDiscoverRows(output) {
    return output
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(line => line.split("\t"));
}

function groupUserRows(rows) {
    const grouped = {};

    rows.forEach(([user, file, svc, status, uid, gid]) => {
        if (user === "__ROOTLESS__") {
            return;
        }

        if (user === "__QUADLET_USER__") {
            if (!grouped[file]) {
                grouped[file] = [];
            }
            return;
        }

        if (!grouped[user]) {
            grouped[user] = [];
        }

        grouped[user].push({
            file,
            svc,
            status,
            uid,
            gid
        });
    });

    return grouped;
}

function renderUserSection(user, entries) {
    const section = document.createElement("div");
    section.className = "user-block";

    const heading = document.createElement("h3");
    heading.textContent = user;

    const userHeader = document.createElement("div");
    userHeader.className = "user-header";
    userHeader.appendChild(heading);
    section.appendChild(userHeader);

    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "file-action-button";
    createBtn.textContent = "Créer un fichier";
    createBtn.addEventListener("click", () => {
        createFile(user);
    });
    section.appendChild(createBtn);

    const table = document.createElement("table");

    entries.forEach(({ file, svc, status, uid, gid }) => {
        if (svc) {
            knownServices.push({
                user,
                file,
                svc
            });
        }

        const tr = document.createElement("tr");

        tr.appendChild(createDataCell(file));
        tr.appendChild(createDataCell(`${uid}:${gid}`, "file-owner"));
        tr.appendChild(createDataCell(status, `status status-${status}`));

        const tdBtn = document.createElement("td");

        tdBtn.appendChild(createActionButton({
            text: "Éditer",
            onClick: () => openEditor(user, file, svc)
        }));

        if (isContainerFile(file)) {
            const normalizedStatus = normalizeStatus(status);
            const isActive = normalizedStatus === "active";

            tdBtn.appendChild(createActionButton({
                text: isActive ? "Stop" : "Start",
                title: isActive
                    ? "Arrêter ce conteneur"
                    : "Démarrer ce conteneur",
                onClick: () => setContainerState(
                    user,
                    file,
                    isActive ? "stop" : "start"
                )
            }));
        }

        tdBtn.appendChild(createActionButton({
            text: "Supprimer",
            onClick: () => deleteFile(user, file)
        }));

        tr.appendChild(tdBtn);
        table.appendChild(tr);
    });

    section.appendChild(table);
    return section;
}

function renderUsers(output) {
    const rows = parseDiscoverRows(output);
    const rootlessUsers = rows
        .filter(([kind]) => kind === "__ROOTLESS__")
        .map(([, user]) => user)
        .sort();

    renderRootlessUsers(rootlessUsers);

    const grouped = groupUserRows(rows);
    const container = getElement("users-list");
    container.innerHTML = "";

    knownUsers = Object.keys(grouped).sort();
    knownServices = [];

    if (Object.keys(grouped).length === 0) {
        container.textContent =
            "Aucun fichier trouvé dans les répertoires Quadlet des utilisateurs.";

        setStatus("");
        return;
    }

    Object.keys(grouped)
        .sort()
        .forEach(user => {
            container.appendChild(renderUserSection(user, grouped[user]));
        });

    setStatus("");
}

function renderRootlessUsers(users) {

    const container =
        document.getElementById("rootless-users");

    container.innerHTML = "";

    if (users.length === 0) {
        container.textContent = "Aucun utilisateur rootless détecté.";
        return;
    }

    users.forEach(user => {
        const item = document.createElement("div");
        item.className = "rootless-user";

        const name = document.createElement("span");
        name.textContent = user;

        const createButton = document.createElement("button");
        createButton.type = "button";
        createButton.className = "rootless-create-button";
        createButton.textContent = "Créer le dossier";
        createButton.title = `Créer le dossier Quadlet de ${user}`;
        createButton.addEventListener("click", () => {
            createQuadletDirectory(user);
        });

        item.appendChild(name);
        item.appendChild(createButton);
        container.appendChild(item);
    });
}

function createQuadletDirectory(user) {

    const script = `
set -e

uid="$(/usr/bin/id -u -- "$1")"
gid="$(/usr/bin/id -g -- "$1")"
config="/home/$1/.config"
containers="/home/$1/.config/containers"
path="/home/$1/.config/containers/systemd"
readme_template="${README_TEMPLATE_PATH}"
readme_target="$path/README.md"

/usr/bin/install -d -m 0755 -o "$uid" -g "$gid" -- "$config"
/usr/bin/install -d -m 0755 -o "$uid" -g "$gid" -- "$containers"
/usr/bin/install -d -m 0755 -o "$uid" -g "$gid" -- "$path"
/usr/bin/chown -- "$uid:$gid" "$config" "$containers" "$path"
/usr/bin/chmod 0755 -- "$config" "$containers" "$path"

[ -f "$readme_template" ]
/usr/bin/install -o "$uid" -g "$gid" -m 0644 -- "$readme_template" "$readme_target"
/usr/bin/chown "$uid:$gid" -- "$readme_target"
/usr/bin/chmod 0644 -- "$readme_target"
/usr/bin/restorecon -- "$containers" "$path" "$readme_target" 2>/dev/null || true

[ "$(/usr/bin/stat -c '%u:%g' -- "$path")" = "$uid:$gid" ]
[ "$(/usr/bin/stat -c '%u:%g' -- "$config")" = "$uid:$gid" ]
[ "$(/usr/bin/stat -c '%u:%g' -- "$containers")" = "$uid:$gid" ]
[ "$(/usr/bin/stat -c '%u:%g' -- "$readme_target")" = "$uid:$gid" ]
[ "$(/usr/bin/stat -c '%a' -- "$readme_target")" = "644" ]
`;

    setStatus(`Création du dossier Quadlet de ${user}...`);

    cockpit.script(
        script,
        [user],
        {
            superuser: "require",
            err: "message"
        }
    )
    .then(() => {
        setStatus(`Dossier Quadlet et README créés pour ${user}.`);
        loadUsers();
    })
    .catch(err => {
        setStatus(`Erreur de création pour ${user} : ${err.message}`);
    });
}

/* ============================================================
 * MISES À JOUR DES CONTENEURS
 * ============================================================ */

function updateAllUser(user) {

    return runAsUser(user, [
        "/usr/bin/systemctl",
        "--user",
        "daemon-reload"
    ])
    .then(() => runAsUser(user, [
        "/usr/bin/podman",
        "auto-update"
    ]))
    .then(() => runAsUser(user, [
        "/usr/bin/podman",
        "image",
        "prune",
        "-af"
    ]));
}

function updateAll() {

    const updateButton =
        document.getElementById("update-all-btn");

    if (knownUsers.length === 0) {
        setStatus("Aucun utilisateur à mettre à jour.");
        return;
    }

    updateButton.disabled = true;

    let failedUsers = 0;

    knownUsers.reduce((chain, user) => {
        return chain.then(() => {
            setStatus(`Mise à jour des conteneurs de ${user}...`);
            return updateAllUser(user);
        }).catch(err => {
            failedUsers += 1;
            setStatus(`Erreur pour ${user} : ${err.message}`);
        });
    }, Promise.resolve())
    .then(() => {
        setStatus(
            failedUsers > 0
                ? `Mise à jour terminée avec ${failedUsers} erreur(s).`
                : "Mise à jour et nettoyage terminés."
        );
        loadUsers();
    })
    .catch(err => {
        setStatus("Erreur de mise à jour : " + err.message);
    })
    .finally(() => {
        updateButton.disabled = false;
    });
}

/* ============================================================
 * CRÉER UN FICHIER
 * ============================================================ */

function createFile(user) {

    const fileName = window.prompt(
        `Nom du fichier à créer pour ${user} :`
    );


    if (fileName === null) {
        return;
    }


    const name = fileName.trim();


    if (!name) {
        window.alert("Le nom du fichier ne peut pas être vide.");
        return;
    }


    /*
     * On refuse les chemins.
     * Le fichier doit être créé directement dans le répertoire
     * systemd de l'utilisateur.
     */
    if (
        name === "." ||
        name === ".." ||
        name.includes("/") ||
        name.includes("\\")
    ) {
        window.alert(
            "Nom de fichier invalide."
        );
        return;
    }


    const path =
        `/home/${user}/.config/containers/systemd/${name}`;


    setStatus(
        `Création de ${name} pour ${user}...`
    );


    /*
     * Récupérer l'UID et le GID de l'utilisateur.
     */

    getUserId(user)
    .then(uid => {
        return getUserGid(user)
        .then(gid => ({ uid, gid }));
    })
    .then(({ uid, gid }) => {

        const script = `
set -C
: > "$1"
chown "$2:$3" -- "$1"
chmod 0644 -- "$1"
restorecon -- "$1"
`;

        return runScriptWithSuperuser(script, [
            path,
            uid,
            gid
        ]);
    })
    .then(() => {

        setStatus(
            `Fichier ${name} créé.`
        );

        loadUsers();

    })
    .catch(err => {

        setStatus(
            `Erreur de création : ${err.message}`
        );

    });
}


/* ============================================================
 * SUPPRIMER UN FICHIER
 * ============================================================ */

function deleteFile(user, file) {

    const confirmed =
        window.confirm(
            `Voulez-vous vraiment supprimer le fichier "${file}" pour l'utilisateur "${user}" ?\n\nCette opération est irréversible.`
        );


    if (!confirmed) {
        return;
    }


    const path =
        `/home/${user}/.config/containers/systemd/${file}`;


    setStatus(
        `Suppression de ${file}...`
    );

    if (file.toLowerCase().endsWith(".container")) {

        const service =
            `${file.slice(0, -".container".length)}.service`;

        const deleteScript = `
file="$1"
service="$2"
container="$(/usr/bin/podman ps -a --filter "label=PODMAN_SYSTEMD_UNIT=$service" --format '{{.ID}}' | head -n 1)"
image=""

if [ -n "$container" ]; then
    image="$(/usr/bin/podman inspect --format '{{.Config.Image}}' "$container")"
fi

/usr/bin/systemctl --user stop "$service" 2>/dev/null || true
/usr/bin/rm -- "$file"
/usr/bin/systemctl --user daemon-reload
/usr/bin/podman rm "$container" 2>/dev/null || true

if [ -n "$image" ]; then
    /usr/bin/podman image rm "$image" 2>/dev/null || true
fi
`;

        cockpit.spawn(
            [
                "machinectl",
                "shell",
                `${user}@`,
                "/bin/bash",
                "-c",
                deleteScript,
                "quadlet-delete",
                path,
                service
            ],
            {
                superuser: "require",
                err: "message"
            }
        )
        .then(() => {
            setStatus(
                `Conteneur, fichier ${file} et image associée supprimés.`
            );
            loadUsers();
        })
        .catch(err => {
            setStatus(
                `Erreur de suppression : ${err.message}`
            );
        });

        return;
    }


    /*
     * Le chemin est passé directement comme argument à rm.
     * Il n'est donc pas injecté dans une commande shell.
     */

    cockpit.spawn(
        [
            "/usr/bin/rm",
            "--",
            path
        ],
        {
            superuser: "require",
            err: "message"
        }
    )
    .then(() => {

        setStatus(
            `Fichier ${file} supprimé.`
        );

        loadUsers();

    })
    .catch(err => {

        setStatus(
            `Erreur de suppression : ${err.message}`
        );

    });
}

/* ============================================================
 * ARRÊTER UN CONTENEUR
 * ============================================================ */

function setContainerState(user, file, action) {

    const service =
        `${file.slice(0, -".container".length)}.service`;

    const confirmed =
        window.confirm(
            `Voulez-vous ${action === "stop" ? "arrêter" : "démarrer"} le conteneur "${service}" pour l'utilisateur "${user}" ?`
        );

    if (!confirmed) {
        return;
    }

    setStatus(
        `${action === "stop" ? "Arrêt" : "Démarrage"} de ${service}...`
    );

    cockpit.spawn(
        [
            "machinectl",
            "shell",
            `${user}@`,
            "/usr/bin/systemctl",
            "--user",
            action,
            service
        ],
        {
            superuser: "require",
            err: "message"
        }
    )
    .then(() => {
        setStatus(
            `${service} ${action === "stop" ? "arrêté" : "démarré"}.`
        );
        loadUsers();
    })
    .catch(err => {
        setStatus(
            `Erreur de ${action === "stop" ? "l'arrêt" : "le démarrage"} de ${service} : ${err.message}`
        );
    });
}

/* ============================================================
 * OUVERTURE DE L'ÉDITEUR
 * ============================================================ */

function openEditor(user, file, svc) {

    currentUser = user;

    currentFile =
        `/home/${user}/.config/containers/systemd/${file}`;

    currentSvc = svc;

    const restartButton =
        document.getElementById("restart-btn");

    const canRestart =
        file.toLowerCase().endsWith(".container");

    restartButton.disabled = !canRestart;
    restartButton.title = canRestart
        ? "Enregistrer puis redémarrer le conteneur"
        : "Disponible uniquement pour les fichiers .container";

    /*
     * Réinitialiser les métadonnées.
     */
    currentFileUid = null;
    currentFileGid = null;
    currentFileMode = null;


    /*
     * Lire les métadonnées AVANT toute modification.
     */
    const statCommand =
        `stat -c '%u %g %a' -- ${JSON.stringify(currentFile)}`;


    cockpit.spawn(
        ["bash", "-c", statCommand],
        {
            superuser: "require",
            err: "message"
        }
    )
    .then(metadata => {

        const values =
            metadata.trim().split(/\s+/);


        if (values.length !== 3) {

            throw new Error(
                "Impossible de récupérer les métadonnées du fichier."
            );

        }


        currentFileUid = values[0];
        currentFileGid = values[1];
        currentFileMode = values[2];


        /*
         * Maintenant seulement, lire le contenu.
         */
        const f = cockpit.file(
            currentFile,
            {
                superuser: "require"
            }
        );


        return f.read()
            .then(content => {

                document.getElementById(
                    "editor-filename"
                ).textContent =
                    `${user} — ${file}`;


                document.getElementById(
                    "editor"
                ).value =
                    content || "";


                /*
                 * Afficher l'éditeur dans le même cadre blanc.
                 */

                document.getElementById(
                    "list-panel"
                ).classList.add("hidden");


                document.getElementById(
                    "editor-panel"
                ).classList.remove("hidden");


                document.getElementById(
                    "editor-msg"
                ).textContent =
                    `UID:GID ${currentFileUid}:${currentFileGid}`;


                f.close();

            })
            .catch(err => {

                f.close();

                throw err;

            });

    })
    .catch(err => {

        document.getElementById(
            "editor-msg"
        ).textContent =
            "Erreur de lecture : " +
            err.message;

    });
}


/* ============================================================
 * SAUVEGARDE
 * ============================================================ */

function saveFile(restart) {

    if (
        restart &&
        (!currentFile || !currentFile.toLowerCase().endsWith(".container"))
    ) {
        document.getElementById(
            "editor-msg"
        ).textContent =
            "Le redémarrage est disponible uniquement pour les fichiers .container.";

        return;
    }

    const content =
        document.getElementById(
            "editor"
        ).value;

    /*
     * Sécurité : on refuse de sauvegarder si les métadonnées
     * originales n'ont pas été récupérées.
     */

    if (
        currentFileUid === null ||
        currentFileGid === null ||
        currentFileMode === null
    ) {

        document.getElementById(
            "editor-msg"
        ).textContent =
            "Erreur : métadonnées du fichier indisponibles.";

        return;
    }


    const f = cockpit.file(
        currentFile,
        {
            superuser: "require"
        }
    );


    document.getElementById(
        "editor-msg"
    ).textContent =
        "Enregistrement...";


    /*
     * 1. Remplacement atomique du contenu.
     */
    f.replace(content)
        .then(() => {

            /*
             * 2. Le replace() a créé un nouvel inode.
             *
             * On restaure :
             *
             * - UID
             * - GID
             * - permissions
             *
             * puis le contexte SELinux associé au chemin.
             */

            const restoreCommand =
                `chown ${currentFileUid}:${currentFileGid} -- ${JSON.stringify(currentFile)} && ` +
                `chmod ${currentFileMode} -- ${JSON.stringify(currentFile)} && ` +
                `restorecon -- ${JSON.stringify(currentFile)}`;


            return cockpit.spawn(
                ["bash", "-c", restoreCommand],
                {
                    superuser: "require",
                    err: "message"
                }
            );

        })
        .then(() => {

            document.getElementById(
                "editor-msg"
            ).textContent =
                "Enregistré.";


            f.close();


            if (restart && currentSvc) {

                restartService(
                    currentUser,
                    currentSvc
                );

            } else {

                loadUsers();

            }

        })
        .catch(err => {

            document.getElementById(
                "editor-msg"
            ).textContent =
                "Erreur d'écriture : " +
                err.message;


            f.close();

        });
}


/* ============================================================
 * REDÉMARRAGE
 * ============================================================ */

function restartService(user, svc) {

    document.getElementById(
        "editor-msg"
    ).textContent =
        "Redémarrage...";


    const cmd =
        `machinectl shell "${user}@" /usr/bin/systemctl --user daemon-reload && ` +
        `machinectl shell "${user}@" /usr/bin/systemctl --user restart "${svc}"`;


    cockpit.spawn(
        ["bash", "-c", cmd],
        {
            superuser: "require",
            err: "message"
        }
    )
    .then(() => {

        document.getElementById(
            "editor-msg"
        ).textContent =
            "Redémarré.";

        loadUsers();

    })
    .catch(err => {

        document.getElementById(
            "editor-msg"
        ).textContent =
            "Erreur redémarrage : " +
            err.message;

    });
}


/* ============================================================
 * ACTUALISER
 * ============================================================ */

document.getElementById(
    "refresh-btn"
).addEventListener(
    "click",
    loadUsers
);

document.getElementById(
    "update-all-btn"
).addEventListener(
    "click",
    updateAll
);


/* ============================================================
 * ENREGISTRER
 * ============================================================ */

document.getElementById(
    "save-btn"
).addEventListener(
    "click",
    () => {
        saveFile(false);
    }
);


/* ============================================================
 * ENREGISTRER ET REDÉMARRER
 * ============================================================ */

document.getElementById(
    "restart-btn"
).addEventListener(
    "click",
    () => {
        saveFile(true);
    }
);


/* ============================================================
 * FERMER
 * ============================================================ */

document.getElementById(
    "close-btn"
).addEventListener(
    "click",
    () => {

        document.getElementById(
            "editor-panel"
        ).classList.add("hidden");


        document.getElementById(
            "list-panel"
        ).classList.remove("hidden");


        document.getElementById(
            "editor-msg"
        ).textContent = "";

    }
);


/* ============================================================
 * INITIALISATION
 * ============================================================ */

loadUsers();
