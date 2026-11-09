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

# Toutes les réponses des restaurants (décision de Walid du 09/11 : rien n'est supposé déjà traité), pour le tri par Claude dans Loop Agent
# (reprise du cerveau, 09/11/2026) : texte coupé avant la citation du mail d'origine,
# adresses et téléphones masqués ; le nom du restaurant est retrouvé par son adresse ou l'objet.
import hashlib


def masquer(t):
    t = re.sub(r"[\w.+-]+@[\w-]+(\.[\w-]+)+", "[adresse masquée]", t)
    return re.sub(r"(?:\+|00)?\d[\d .\-()]{7,}\d", lambda m: "[téléphone masqué]" if len(re.sub(r"\D", "", m.group(0))) >= 9 else m.group(0), t)


par_email = {str(p.get("email") or "").lower(): p for p in prospects if p.get("email")}
# Mes réponses (Walid), lues dans np_mes_reponses (Nour Meet 5, dossier Envoyés) : adresse et date seulement.
mes_envois = {}
mes_lignes = tableau("np_mes_reponses", ids)
for m in mes_lignes:
    a = str(m.get("destinataire") or "").lower()
    if a and m.get("envoye"):
        mes_envois.setdefault(a, []).append(str(m["envoye"]))
noms_longs = sorted([p for p in prospects if len(str(p.get("nom") or "")) >= 5], key=lambda p: -len(str(p.get("nom"))))
a_trier = []
for r in reponses:
    j = jour_de(r.get("recu"))
    if not j:
        continue
    objet = str(r.get("objet") or "")
    brut = str(r.get("texte") or "")
    p = par_email.get(str(r.get("email") or "").lower()) or next((x for x in noms_longs if objet and str(x.get("nom")).lower() in objet.lower()), None)
    cle = hashlib.sha256(f"{j}|{r.get('de') or r.get('email') or ''}|{objet}|{brut[:200]}".encode()).hexdigest()[:16]
    adresses = {str(r.get("email") or "").lower(), str((p or {}).get("email") or "").lower()} - {""}
    recu = str(r.get("recu") or "")
    apres = sorted(d for a in adresses for d in mes_envois.get(a, []) if d >= recu)
    texte = re.split(r"\n\s*(?:>|Le .{0,120}a écrit|De ?:|From ?:)", brut)[0]
    a_trier.append({
        "cle": cle, "jour": j,
        "nom": str(p.get("nom"))[:80] if p and p.get("nom") else None,
        "ville": str(p.get("ville"))[:40] if p and p.get("ville") else None,
        "objet": masquer(objet)[:150], "texte": masquer(texte).strip()[:800],
        "repondu_le": jour_de(apres[0]) if apres else None,
    })
corps["reponses"] = sorted(a_trier, key=lambda x: x["jour"])[-200:]

# Ce que Walid a écrit aux restaurants (décision de Walid du 09/11) : seulement les mails envoyés
# à un restaurant prospecté ou à quelqu'un qui a répondu à la prospection, numéros et adresses masqués.
expediteurs = {str(r.get("email") or "").lower(): r for r in reponses if r.get("email")}
mes_reponses = []
for m in mes_lignes:
    a = str(m.get("destinataire") or "").lower()
    p = par_email.get(a)
    if not p and a not in expediteurs:
        continue
    if not p:
        objet_r = str(expediteurs[a].get("objet") or "")
        p = next((x for x in noms_longs if objet_r and str(x.get("nom")).lower() in objet_r.lower()), None)
    j = jour_de(m.get("envoye"))
    if not j:
        continue
    mes_reponses.append({
        "cle": hashlib.sha256(f"{a}|{m.get('envoye')}".encode()).hexdigest()[:16], "jour": j,
        "nom": str(p.get("nom"))[:80] if p and p.get("nom") else None,
        "objet": masquer(str(m.get("objet") or ""))[:150], "texte": masquer(str(m.get("texte") or "")).strip()[:1500],
    })
corps["mes_reponses"] = sorted(mes_reponses, key=lambda x: x["jour"])[-200:]

# Restaurants inscrits et abonnés, lus dans la base de l'application Nūr Meet (même serveur),
# en LECTURE SEULE : comptes « ORGANIZER » hors démo, abonnements actifs. Seulement des nombres.
SQL = """
SELECT json_build_object(
  'jours', (SELECT coalesce(json_object_agg(j, n), '{}') FROM (
      SELECT to_char("createdAt" AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD') j, count(*) n FROM "User"
      WHERE role = 'ORGANIZER' AND NOT "isDemo" AND "deletedAt" IS NULL
        AND "createdAt" > now() - interval '3 days' GROUP BY 1) t),
  'total', (SELECT count(*) FROM "User" WHERE role = 'ORGANIZER' AND NOT "isDemo" AND "deletedAt" IS NULL),
  'abonnes', (SELECT count(DISTINCT "restaurantId") FROM "RestaurantSubscription"
      WHERE lower(status::text) IN ('active', 'trialing') AND "cancelledAt" IS NULL)
);
"""
try:
    import subprocess
    sortie = subprocess.run(
        ["docker", "exec", "-i", "nour-v2-postgres-1", "sh", "-c", 'psql -U "$POSTGRES_USER" -d "${POSTGRES_DB:-nour_meet}" -At -v ON_ERROR_STOP=1'],
        input=SQL, capture_output=True, text=True, timeout=30,
    )
    if sortie.returncode == 0 and sortie.stdout.strip():
        r = json.loads(sortie.stdout.strip().splitlines()[-1])
        for d in jours:
            stats[d]["inscriptions"] = int((r.get("jours") or {}).get(d, 0))
        corps["restaurants"] = {"total": int(r.get("total") or 0), "abonnes": int(r.get("abonnes") or 0)}
    else:
        print("base Nūr Meet illisible :", (sortie.stderr or "").strip()[:200])
except Exception as e:
    print("base Nūr Meet illisible :", str(e)[:200])

if ESSAI:
    print(json.dumps({**corps, "reponses": f"{len(corps.get('reponses', []))} réponse(s) à trier (textes non affichés)", "mes_reponses": f"{len(corps.get('mes_reponses', []))} mail(s) de Walid (textes non affichés)"}, ensure_ascii=False, indent=1))
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
