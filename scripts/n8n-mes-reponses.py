#!/usr/bin/env python3
"""Crée dans n8n (serveur Nūr) de quoi savoir à quels restaurants Walid a répondu (09/11/2026).

- un tableau « np_mes_reponses » : seulement l'adresse du destinataire et la date d'envoi ;
- une automatisation « Nour Meet 5 - Mes réponses envoyées », ÉTEINTE à la création, qui lit le
  dossier « Envoyés » (Sent) de contact@nourmeet.com avec le même accès IMAP que Nour Meet 4,
  et ne garde jamais le texte des mails.
Walid l'allume ensuite lui-même dans n8n (bouton Publish / Active).
Le relevé horaire (scripts/nour-meet-releve.py) lit ce tableau : une réponse de restaurant suivie
d'un mail de Walid à la même adresse est « répondue », et Loop Agent ferme la demande tout seul.

    python3 n8n-mes-reponses.py            # crée le tableau et l'automatisation (éteinte)
    python3 n8n-mes-reponses.py --dossier "INBOX.Sent"   # autre nom de dossier si « Sent » échoue
"""
import json
import pathlib
import sys
import urllib.error
import urllib.request

env = {}
for ligne in (pathlib.Path.home() / "outils" / "sauvegarde-n8n" / ".env").read_text().splitlines():
    if "=" in ligne and not ligne.lstrip().startswith("#"):
        k, v = ligne.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
BASE = (env.get("N8N_URL") or "https://n8n.nourmeet.com").rstrip("/")
DOSSIER = sys.argv[sys.argv.index("--dossier") + 1] if "--dossier" in sys.argv else "Sent"
NOM = "Nour Meet 5 - Mes réponses envoyées (pour Loop Agent)"


def api(chemin, data=None, methode=None):
    req = urllib.request.Request(
        BASE + chemin,
        headers={"X-N8N-API-KEY": env["N8N_API_KEY"], "content-type": "application/json"},
        data=json.dumps(data).encode() if data is not None else None,
        method=methode,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"n8n refuse ({e.code}) : {e.read()[:300].decode(errors='replace')}")


tables = {t["name"]: t["id"] for t in api("/api/v1/data-tables?limit=100").get("data") or []}
if "np_mes_reponses" in tables:
    print("Tableau np_mes_reponses : déjà là.")
else:
    api("/api/v1/data-tables", {"name": "np_mes_reponses", "columns": [{"name": "destinataire", "type": "string"}, {"name": "envoye", "type": "string"}]}, "POST")
    print("Tableau np_mes_reponses : créé.")

flux = api("/api/v1/workflows?limit=200").get("data") or []
imap = None
for w in flux:
    if w["name"].startswith("Nour Meet 4"):
        for n in w["nodes"]:
            if n["type"] == "n8n-nodes-base.emailReadImap":
                imap = n.get("credentials", {}).get("imap")
if not imap:
    sys.exit("Accès IMAP de Nour Meet 4 introuvable : rien n'est créé.")

CODE = r"""// Mes réponses (Walid) : seulement le destinataire et la date, jamais le texte.
const out = [];
for (const { json: m } of $input.all()) {
  const to = String(m.to || '') + ',' + String(m.cc || '');
  const adrs = [...new Set((to.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) || []).map((a) => a.toLowerCase()))];
  const d = m.date ? new Date(m.date) : new Date();
  for (const a of adrs) if (a !== 'contact@nourmeet.com') out.push({ json: { destinataire: a, envoye: (isNaN(d) ? new Date() : d).toISOString() } });
}
return out;"""

wf = {
    "name": NOM,
    "settings": {"executionOrder": "v1"},
    "nodes": [
        {"id": "nm5-imap", "name": "Mail envoyé (IMAP, dossier Envoyés)", "type": "n8n-nodes-base.emailReadImap", "typeVersion": 2.1, "position": [0, 0],
         "parameters": {"mailbox": DOSSIER, "postProcessAction": "nothing", "format": "simple", "options": {"customEmailConfig": '["ALL", ["SINCE", "2026-09-25"]]', "trackLastMessageId": True}},
         "credentials": {"imap": imap}},
        {"id": "nm5-code", "name": "Garder destinataire et date", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [260, 0], "parameters": {"jsCode": CODE}},
        {"id": "nm5-table", "name": "Écrire np_mes_reponses", "type": "n8n-nodes-base.dataTable", "typeVersion": 1.1, "position": [520, 0],
         "parameters": {"dataTableId": {"__rl": True, "mode": "name", "value": "np_mes_reponses"},
                        "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": [], "attemptToConvertTypes": False, "convertFieldsToString": False}, "options": {}}},
    ],
    "connections": {
        "Mail envoyé (IMAP, dossier Envoyés)": {"main": [[{"node": "Garder destinataire et date", "type": "main", "index": 0}]]},
        "Garder destinataire et date": {"main": [[{"node": "Écrire np_mes_reponses", "type": "main", "index": 0}]]},
    },
}
deja = [w for w in flux if w["name"] == NOM]
if deja:
    api(f"/api/v1/workflows/{deja[0]['id']}", wf, "PUT")
    print(f"Automatisation « {NOM} » : mise à jour (dossier « {DOSSIER} »).")
else:
    api("/api/v1/workflows", wf, "POST")
    print(f"Automatisation « {NOM} » : créée, ÉTEINTE (dossier « {DOSSIER} »). Allume-la dans n8n.")
