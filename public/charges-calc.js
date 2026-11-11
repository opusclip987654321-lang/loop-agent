// Onglet Suivi des charges (demande de Walid du 11/11/2026) : calculs partagés par le site
// et le serveur (outils des agents), comme periodes.js.
// Pour chaque copropriété : ce que le syndic appelle, ce que Walid paie, les frais que le
// syndic (ou son avocat, son commissaire de justice) ajoute, et les soldes qu'il annonce.
// Le but : voir mois par mois si tout est cohérent et repérer tout frais ajouté sans raison.
// Aucun montant ni nom de copropriété ici : les données vivent dans la base (champ `charges`).
(function (root) {
  'use strict';

  const KINDS = ['Appel de fonds', 'Paiement', 'Frais ajouté', 'Solde annoncé', 'Crédit / régularisation'];
  const RUBRICS = ['charges', 'fonds de travaux', 'avances / travaux exceptionnels', 'tout compris'];
  const FEE_KINDS = ['Relance', 'Mise en demeure', 'Frais de recouvrement (syndic)', 'Frais d’avocat', 'Commissaire de justice', 'Autre'];
  const FEE_STATES = ['à vérifier', 'à contester', 'contesté', 'payé', 'justifié'];
  const RECORDED = ['oui', 'non', 'à vérifier'];
  // Écart toléré entre deux soldes (arrondis du syndic).
  const TOLERANCE = 1;

  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const monthOf = (l) => (l.date ? String(l.date).slice(0, 7) : /^\d{4}-\d{2}$/.test(l.month || '') ? l.month : '');
  // Clé de tri : la date, ou le dernier jour du mois quand seule la période est connue.
  const sortKey = (l) => l.date || (monthOf(l) ? monthOf(l) + '-31' : '9999');
  const byDate = (a, b) => sortKey(a).localeCompare(sortKey(b));
  const frDate = (d) => {
    if (!d) return '';
    const [y, m, j] = String(d).split('-');
    return j ? `${j}/${m}/${y}` : `${m}/${y}`;
  };
  const eur = (n) => r2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  const rubricOf = (l) => l.rubric || 'charges';
  // Ce qu'une ligne ajoute à la dette de Walid envers le syndic (le solde annoncé ne bouge rien).
  function effect(l) {
    const a = Number(l.amount) || 0;
    if (l.kind === 'Appel de fonds' || l.kind === 'Frais ajouté') return a;
    if (l.kind === 'Paiement' || l.kind === 'Crédit / régularisation') return -a;
    return 0;
  }

  function analyse(list, now = new Date()) {
    const lines = (Array.isArray(list) ? list : []).filter((l) => l && l.copro && KINDS.includes(l.kind));
    const copros = [...new Set(lines.map((l) => l.copro))].sort((a, b) => a.localeCompare(b, 'fr'));
    const alertes = [];
    const alert = (copro, gravite, type, texte, ids) => alertes.push({ copro, gravite, type, texte, ids });
    const today = now.toISOString().slice(0, 10);

    const out = copros.map((copro) => {
      const ls = lines.filter((l) => l.copro === copro).sort(byDate);
      const t = { appele: 0, paye: 0, frais: 0, credits: 0 };
      const months = {};
      for (const l of ls) {
        const k = monthOf(l) || 'date inconnue';
        const m = (months[k] = months[k] || { mois: k, appele: 0, paye: 0, frais: 0, credits: 0, soldes: [] });
        const a = Number(l.amount) || 0;
        if (l.kind === 'Appel de fonds') (m.appele += a), (t.appele += a);
        else if (l.kind === 'Paiement') (m.paye += a), (t.paye += a);
        else if (l.kind === 'Frais ajouté') (m.frais += a), (t.frais += a);
        else if (l.kind === 'Crédit / régularisation') (m.credits += a), (t.credits += a);
        else if (l.kind === 'Solde annoncé') m.soldes.push({ id: l.id, date: l.date || '', montant: r2(a), rubrique: rubricOf(l), source: l.source || '' });
      }
      const mois = Object.values(months)
        .sort((a, b) => a.mois.localeCompare(b.mois))
        .map((m) => ({ ...m, appele: r2(m.appele), paye: r2(m.paye), frais: r2(m.frais), credits: r2(m.credits), ecart: r2(m.appele + m.frais - m.paye - m.credits) }));

      // Soldes annoncés par le syndic, rubrique par rubrique : se contredisent-ils ?
      const soldes = ls.filter((l) => l.kind === 'Solde annoncé');
      const dernierSoldes = {};
      for (const rub of [...new Set(soldes.map(rubricOf))]) {
        const s = soldes.filter((l) => rubricOf(l) === rub);
        for (let i = 1; i < s.length; i++) {
          const a = s[i - 1];
          const b = s[i];
          if (sortKey(a) === sortKey(b)) {
            if (Math.abs((Number(a.amount) || 0) - (Number(b.amount) || 0)) > TOLERANCE)
              alert(copro, 'rouge', 'Soldes contradictoires', `Deux soldes différents pour la même date (${frDate(a.date || monthOf(a))}, ${rub}) : ${eur(a.amount)} (${a.source || 'source ?'}) et ${eur(b.amount)} (${b.source || 'source ?'}). À faire expliquer par le syndic.`, [a.id, b.id]);
            continue;
          }
          // Solde attendu = solde précédent + ce qui a été appelé ou ajouté − ce qui a été payé entre les deux.
          const between = ls.filter((l) => l.kind !== 'Solde annoncé' && (rub === 'tout compris' || rubricOf(l) === rub) && sortKey(l) > sortKey(a) && sortKey(l) <= sortKey(b));
          const attendu = r2((Number(a.amount) || 0) + between.reduce((x, l) => x + effect(l), 0));
          const diff = r2((Number(b.amount) || 0) - attendu);
          if (Math.abs(diff) > TOLERANCE)
            alert(copro, 'rouge', 'Solde incohérent', `Le syndic annonce ${eur(b.amount)} au ${frDate(b.date || monthOf(b))} (${rub}). Avec le solde de ${eur(a.amount)} au ${frDate(a.date || monthOf(a))} et les mouvements notés entre les deux, on attendrait ${eur(attendu)} : écart de ${diff > 0 ? '+' : ''}${eur(diff)}. Soit un appel, un frais ou un paiement manque ici, soit le syndic doit l’expliquer.`, [a.id, b.id]);
        }
        const last = s[s.length - 1];
        const after = ls.filter((l) => l.kind !== 'Solde annoncé' && (rub === 'tout compris' || rubricOf(l) === rub) && sortKey(l) > sortKey(last));
        dernierSoldes[rub] = { date: last.date || monthOf(last), montant: r2(last.amount), source: last.source || '', solde_attendu_aujourdhui: r2((Number(last.amount) || 0) + after.reduce((x, l) => x + effect(l), 0)) };
      }

      // Paiements que le syndic n'a pas enregistrés.
      for (const l of ls.filter((x) => x.kind === 'Paiement')) {
        if (l.recorded === 'non') alert(copro, 'rouge', 'Paiement non enregistré', `Paiement de ${eur(l.amount)} du ${frDate(l.date || monthOf(l))} absent du compte du syndic. Demander qu’il soit crédité, preuve de virement à l’appui.`, [l.id]);
        else if (l.recorded === 'oui' && Number(l.recordedAmount) > 0 && Math.abs(Number(l.recordedAmount) - (Number(l.amount) || 0)) > TOLERANCE)
          alert(copro, 'rouge', 'Écart banque / syndic', `Le ${frDate(l.date || monthOf(l))}, ${eur(l.amount)} payé${l.bank ? ` (${l.bank})` : ''}, mais le syndic n’a crédité que ${eur(l.recordedAmount)} : écart de ${eur((Number(l.amount) || 0) - Number(l.recordedAmount))}. Demander où est passée la différence.`, [l.id]);
        else if (l.recorded === 'à vérifier') alert(copro, 'jaune', 'Paiement à pointer', `Paiement de ${eur(l.amount)} du ${frDate(l.date || monthOf(l))} : vérifier sur le prochain relevé du syndic qu’il est bien crédité.`, [l.id]);
      }

      // Frais ajoutés : sans justificatif, à vérifier, répétés, en double.
      const fees = ls.filter((x) => x.kind === 'Frais ajouté');
      for (const l of fees) {
        const st = l.state || 'à vérifier';
        const what = `${l.label || l.feeKind || 'Frais'} de ${eur(l.amount)} (${frDate(l.date || monthOf(l))})`;
        if (st === 'justifié' || st === 'contesté') continue;
        if (l.proof !== true) alert(copro, 'rouge', 'Frais sans justificatif', `${what} : aucun justificatif (facture, décision d’AG, mise en demeure préalable). Le demander au syndic avant de payer ; s’il n’en a pas, le contester.`, [l.id]);
        else if (st === 'à vérifier') alert(copro, 'jaune', 'Frais à vérifier', `${what} : justificatif reçu, à relire.`, [l.id]);
      }
      const feeMonths = {};
      for (const l of fees) {
        const k = l.feeKind || 'Autre';
        (feeMonths[k] = feeMonths[k] || new Set()).add(monthOf(l));
      }
      for (const [k, set] of Object.entries(feeMonths))
        if (set.size >= 2) alert(copro, 'jaune', 'Frais répétés', `« ${k} » facturé sur ${set.size} mois différents (${[...set].sort().map((m) => frDate(m)).join(', ')}). Vérifier que chacun correspond à une démarche réelle.`, fees.filter((l) => (l.feeKind || 'Autre') === k).map((l) => l.id));
      const seen = new Map();
      for (const l of fees) {
        const key = `${monthOf(l)}|${r2(l.amount)}|${String(l.feeKind || l.label || '').toLowerCase()}`;
        if (seen.has(key)) alert(copro, 'rouge', 'Frais en double ?', `Deux frais « ${l.feeKind || l.label || 'Frais'} » de ${eur(l.amount)} le même mois (${frDate(monthOf(l))}). Possible double facturation.`, [seen.get(key), l.id]);
        else seen.set(key, l.id);
      }

      // Plus aucun paiement depuis longtemps alors que le syndic continue d'appeler.
      const pays = ls.filter((x) => x.kind === 'Paiement');
      const lastPay = pays.length ? pays[pays.length - 1] : null;
      const lastPayKey = lastPay ? sortKey(lastPay) : '';
      const callsAfter = ls.filter((x) => x.kind === 'Appel de fonds' && sortKey(x) > lastPayKey && sortKey(x) <= today);
      if (callsAfter.length) {
        const days = lastPay ? Math.floor((Date.parse(today) - Date.parse(sortKey(lastPay).replace(/-31$/, '-28'))) / 86400000) : null;
        if (days === null || days > 45)
          alert(copro, 'rouge', 'Pas de paiement noté', `${lastPay ? `Dernier paiement noté le ${frDate(lastPay.date || monthOf(lastPay))}` : 'Aucun paiement noté'} ; ${callsAfter.length} appel(s) de fonds depuis, pour ${eur(callsAfter.reduce((x, l) => x + (Number(l.amount) || 0), 0))}. Chaque mois sans paiement ouvre la porte à de nouveaux frais de relance.`, callsAfter.map((l) => l.id));
      }

      return {
        copro,
        totaux_eur: { appele: r2(t.appele), paye: r2(t.paye), frais_ajoutes: r2(t.frais), credits: r2(t.credits), ecart: r2(t.appele + t.frais - t.paye - t.credits) },
        frais_par_etat_eur: FEE_STATES.reduce((o, s) => ((o[s] = r2(fees.filter((l) => (l.state || 'à vérifier') === s).reduce((x, l) => x + (Number(l.amount) || 0), 0))), o), {}),
        soldes_annonces: dernierSoldes,
        dernier_paiement: lastPay ? lastPay.date || monthOf(lastPay) : null,
        mois,
      };
    });
    const g = { rouge: 0, jaune: 1 };
    alertes.sort((a, b) => g[a.gravite] - g[b.gravite] || a.copro.localeCompare(b.copro, 'fr'));
    return { copros: out, alertes };
  }

  root.LACharges = { KINDS, RUBRICS, FEE_KINDS, FEE_STATES, RECORDED, TOLERANCE, analyse, monthOf, sortKey, frDate, eur };
})(typeof window !== 'undefined' ? window : globalThis);
