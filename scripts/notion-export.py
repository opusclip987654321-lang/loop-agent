#!/usr/bin/env python3
"""Export unique de l'historique Notion des loops (09/11/2026), pour l'importer dans Loop Agent
avant d'éteindre le cerveau central. LECTURE SEULE : rien n'est modifié dans Notion.

À lancer sur le serveur Nūr (le jeton Notion du cerveau est dans ~/cerveau-central/.env) ;
écrit le JSON sur la sortie standard :
    python3 notion-export.py | ssh loop-agent-vps 'docker exec -i loop-agent node scripts/import-notion.js'
- « 📜 Décisions des loops » : date, loop, type, décision, pourquoi ;
- « 🧠 Mes projets » : la page complète de chaque projet (objectif, pistes, leçons…) en texte ;
- « ✅ Fait pour Walid » : les lignes (peu nombreuses).
"""
import json
import pathlib
import sys
import urllib.request

env = {}
for l in (pathlib.Path.home() / "cerveau-central" / ".env").read_text().splitlines():
    if "=" in l and not l.lstrip().startswith("#"):
        k, v = l.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
JETON = env.get("NOTION_TOKEN") or sys.exit("NOTION_TOKEN absent")
DECISIONS = "1d6b9e2267e94c41b05a5a2a39b1f7e2"
PROJETS = "c0c71087a80f41eca860ebf6cc8bf39a"
FAIT = "f82d8065e5ee4f369504cdfef77078b2"


def api(chemin, corps=None):
    req = urllib.request.Request(
        "https://api.notion.com/v1" + chemin,
        data=json.dumps(corps).encode() if corps is not None else None,
        method="POST" if corps is not None else "GET",
        headers={"Authorization": f"Bearer {JETON}", "Notion-Version": "2022-06-28", "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def lignes(base):
    out, curseur = [], None
    for _ in range(50):
        rep = api(f"/databases/{base}/query", {"page_size": 100, **({"start_cursor": curseur} if curseur else {})})
        out += rep["results"]
        curseur = rep.get("next_cursor")
        if not rep.get("has_more"):
            break
    return out


def texte(prop):
    if not prop:
        return None
    t = prop.get("type")
    if t in ("title", "rich_text"):
        return "".join(x.get("plain_text", "") for x in prop[t]) or None
    if t == "select":
        return (prop["select"] or {}).get("name")
    if t == "date":
        return ((prop["date"] or {}).get("start") or "")[:10] or None
    if t == "number":
        return prop["number"]
    if t == "url":
        return prop["url"]
    return None


def contenu(bloc_id, profondeur=0):
    """Texte d'une page Notion (blocs et sous-blocs), sans les bases intégrées."""
    out, curseur = [], None
    for _ in range(30):
        rep = api(f"/blocks/{bloc_id}/children?page_size=100" + (f"&start_cursor={curseur}" if curseur else ""))
        for b in rep["results"]:
            t = b["type"]
            riche = (b.get(t) or {}).get("rich_text")
            if riche is not None:
                ligne = "".join(x.get("plain_text", "") for x in riche).strip()
                if ligne:
                    prefixe = {"heading_1": "# ", "heading_2": "## ", "heading_3": "### ", "bulleted_list_item": "- ", "numbered_list_item": "- ", "to_do": "- "}.get(t, "")
                    out.append("  " * profondeur + prefixe + ligne)
            if b.get("has_children") and t not in ("child_database", "child_page") and profondeur < 3:
                out += contenu(b["id"], profondeur + 1)
        curseur = rep.get("next_cursor")
        if not rep.get("has_more"):
            break
    return out


decisions = []
for p in lignes(DECISIONS):
    pr = p["properties"]
    decisions.append({"date": texte(pr.get("Date")) or p["created_time"][:10], "loop": texte(pr.get("Loop")), "type": texte(pr.get("Type")), "decision": texte(pr.get("Décision")), "pourquoi": texte(pr.get("Pourquoi"))})

pages = []
for p in lignes(PROJETS):
    pr = p["properties"]
    titre = next((texte(v) for v in pr.values() if v.get("type") == "title"), None)
    cle = texte(pr.get("Clé"))
    pages.append({"cle": cle, "titre": titre, "texte": "\n".join(contenu(p["id"]))[:20000]})

# Pages communes : règles des loops et revue hebdo du système (rangées dans « Gestion de Loop Agent »).
for cle, pid, titre in (("regles", "4005dedc4354814c9ec3dae42230a58b", "Règles des loops"), ("revue-systeme", "3ff5dedc43548197a527d86b18708188", "Revue hebdo du système")):
    pages.append({"cle": cle, "titre": titre, "texte": "\n".join(contenu(pid))[:20000]})

fait = []
for p in lignes(FAIT):
    pr = p["properties"]
    fait.append({"date": texte(pr.get("Date")), "projet": texte(pr.get("Projet")), "quoi": texte(pr.get("Quoi")), "nombre": texte(pr.get("Nombre")), "par": texte(pr.get("Par"))})

print(json.dumps({"exporte": __import__("datetime").datetime.now().isoformat(timespec="minutes"), "decisions": decisions, "pages": pages, "fait": fait}, ensure_ascii=False))
print(f"Export Notion : {len(decisions)} décision(s), {len(pages)} page(s) projet, {len(fait)} ligne(s) « Fait pour Walid ».", file=sys.stderr)
