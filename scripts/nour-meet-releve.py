#!/usr/bin/env python3
"""Relevé chiffré de la prospection Nūr Meet, envoyé à Loop Agent (reprise du cerveau central).

À installer sur le VPS Nūr, dans ~/outils/nour-releve/, lancé chaque heure par cron.
- Lit les tableaux n8n np_envois, np_ouvertures, np_reponses, np_prospects (API publique,
  LECTURE SEULE) avec la clé n8n déjà rangée dans ~/outils/sauvegarde-n8n/.env.
- Calcule SEULEMENT des chiffres, pour aujourd'hui et hier (heure de Paris) et sur 7 jours :
  premiers mails, relances, échecs, ouvertures, réponses, restaurants découverts, versions.
  Aucun nom, aucune adresse, aucun texte ne sort de ce serveur.
- Les envoie à Loop Agent (POST /releve/nour-meet) avec le jeton de ~/outils/nour-releve/jeton.
Mêmes règles que le cerveau : envoyé = statut « envoye », échec = « echec », lignes « test »
ignorées, version et type lus dans le lien (utm_campaign=v3-initial), première ouverture seulement.
    python3 releve.py          # relève et envoie
    python3 releve.py --essai  # relève et affiche, n'envoie rien
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

ICI = pathlib.Path(__file__).resolve().parent
ENV_N8N = pathlib.Path.home() / "outils" / "sauvegarde-n8n" / ".env"
LOOP_AGENT = "https://loopagent.actualitevideo.fr/releve/nour-meet"
PARIS = ZoneInfo("Europe/Paris")
ESSAI = "--essai" in sys.argv


def lire_env(chemin):
    env = {}
    for ligne in chemin.read_text().splitlines():
        if "=" in ligne and not ligne.lstrip().startswith("#"):
            k, v = ligne.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


env = lire_env(ENV_N8N)
BASE = (env.get("N8N_URL") or "https://n8n.nourmeet.com").rstrip("/")
CLE = env.get("N8N_API_KEY") or sys.exit("N8N_API_KEY absent de ~/outils/sauvegarde-n8n/.env")


def api(chemin):
    req = urllib.request.Request(BASE + chemin, headers={"X-N8N-API-KEY": CLE, "accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def tableau(nom, ids):
    if nom not in ids:
        return []
    lignes, curseur = [], None
    for _ in range(40):
        q = "?limit=250" + ("&cursor=" + urllib.parse.quote(curseur) if curseur else "")
        rep = api(f"/api/v1/data-tables/{urllib.parse.quote(ids[nom])}/rows{q}")
        lignes += rep.get("data") or []
        curseur = rep.get("nextCursor")
        if not curseur:
            break
    return lignes


def jour_de(valeur):
    """Même lecture que le cerveau (jourDe) : « 07/11/2026 … », ISO, ou « 2026-11-07 09:00 »."""
    if valeur in (None, ""):
        return None
    t = str(valeur).strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", t)
    if m:
        return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}"
    if re.match(r"^\d{4}-\d{2}-\d{2} \d", t):
        t = t.replace(" ", "T", 1)
    try:
        d = datetime.datetime.fromisoformat(t.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.astimezone(PARIS).date().isoformat()


def version_et_type(objet, corps):
    c = str(corps or "")
    m = re.search(r"utm_campaign=v(\d+)-(initial|relance1|relance2)", c)
    if m:
        return int(m.group(1)), m.group(2)
    v = re.search(r"utm_campaign=v(\d+)-", c)
    version = int(v.group(1)) if v else 1
    o = str(objet or "")
    typ = "relance2" if re.match(r"(?i)^dernier message", o) else "relance1" if re.search(r"\?\s*$", o) else "initial"
    return version, typ


ids = {t["name"]: t["id"] for t in (api("/api/v1/data-tables?limit=100").get("data") or [])}
envois = [l for l in tableau("np_envois", ids) if l.get("statut") != "test"]
ouvertures = tableau("np_ouvertures", ids)
reponses = tableau("np_reponses", ids)
prospects = [l for l in tableau("np_prospects", ids) if l.get("statut") != "test"]
if not envois and "np_envois" not in ids:
    sys.exit("tableau np_envois introuvable dans n8n")

aujourdhui = datetime.datetime.now(PARIS).date()
jours = [(aujourdhui - datetime.timedelta(days=i)).isoformat() for i in (1, 0)]
debut7 = (aujourdhui - datetime.timedelta(days=6)).isoformat()


def jour_envoi(l):
    return jour_de(l.get("date_decision")) or jour_de(l.get("date_proposition"))


premiere_ouverture = {}
for o in ouvertures:
    d = jour_de(o.get("date"))
    k = str(o.get("envoi_id"))
    if d and (k not in premiere_ouverture or d < premiere_ouverture[k]):
        premiere_ouverture[k] = d

stats = {}
for d in jours:
    s = {"premiers": 0, "relances": 0, "echecs": 0, "ouvertures": 0, "reponses": 0, "decouverts": 0, "versions": {}}
    for l in envois:
        if jour_envoi(l) != d:
            continue
        if l.get("statut") == "echec":
            s["echecs"] += 1
        elif l.get("statut") == "envoye":
            v, typ = version_et_type(l.get("objet"), l.get("corps"))
            s["premiers" if typ == "initial" else "relances"] += 1
            s["versions"][f"v{v}"] = s["versions"].get(f"v{v}", 0) + 1
    s["ouvertures"] = sum(1 for x in premiere_ouverture.values() if x == d)
    s["reponses"] = sum(1 for r in reponses if jour_de(r.get("recu")) == d)
    s["decouverts"] = sum(1 for p in prospects if jour_de(p.get("date_decouverte")) == d)
    stats[d] = s

envoyes7 = [l for l in envois if l.get("statut") == "envoye" and (jour_envoi(l) or "") >= debut7]
ouverts7 = sum(1 for l in envoyes7 if str(l.get("id")) in premiere_ouverture)
corps = {"jours": stats, "glissant7": {"envoyes": len(envoyes7), "ouverts": ouverts7}}

if ESSAI:
    print(json.dumps(corps, ensure_ascii=False, indent=1))
    sys.exit(0)

jeton = (ICI / "jeton").read_text().strip()
req = urllib.request.Request(
    LOOP_AGENT,
    data=json.dumps(corps).encode(),
    method="POST",
    headers={"Authorization": f"Bearer {jeton}", "content-type": "application/json", "user-agent": "nour-releve"},
)
with urllib.request.urlopen(req, timeout=30) as r:
    rep = json.load(r)
print(datetime.datetime.now(PARIS).isoformat(timespec="minutes"), "envoyé :", ", ".join(rep.get("ecrits") or []) or "rien à écrire")
