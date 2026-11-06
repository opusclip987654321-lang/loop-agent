// Serveur MCP minimal (transport « Streamable HTTP », réponses JSON simples).
// Un connecteur claude.ai envoie des requêtes JSON-RPC en POST sur une seule adresse.
// Ce module ne gère que le protocole ; les outils sont fournis par l'appelant.

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

// tools : [{ name, description, inputSchema, handler(args, ctx) -> string | object }]
export function createMcpHandler({ name, version, instructions, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  async function handleOne(msg, ctx) {
    if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcError(msg && msg.id, -32600, 'Requête invalide');
    }
    const isNotification = msg.id === undefined || msg.id === null;
    const p = msg.params || {};
    try {
      switch (msg.method) {
        case 'initialize': {
          const asked = p.protocolVersion;
          const protocolVersion = SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0];
          return rpcResult(msg.id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name, version },
            ...(instructions ? { instructions } : {}),
          });
        }
        case 'ping':
          return rpcResult(msg.id, {});
        case 'tools/list':
          return rpcResult(msg.id, {
            tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
          });
        case 'tools/call': {
          const tool = byName.get(p.name);
          if (!tool) return rpcError(msg.id, -32602, 'Outil inconnu : ' + p.name);
          try {
            const out = await tool.handler(p.arguments || {}, ctx);
            if (out && typeof out === 'object' && Array.isArray(out.content))
              return rpcResult(msg.id, { content: out.content, isError: false });
            const text = typeof out === 'string' ? out : JSON.stringify(out, null, 2);
            return rpcResult(msg.id, { content: [{ type: 'text', text }], isError: false });
          } catch (e) {
            // Erreur métier : renvoyée à l'agent pour qu'il corrige sa demande.
            return rpcResult(msg.id, { content: [{ type: 'text', text: String(e.message || e) }], isError: true });
          }
        }
        default:
          if (isNotification) return null; // notifications/initialized, etc.
          return rpcError(msg.id, -32601, 'Méthode inconnue : ' + msg.method);
      }
    } catch (e) {
      return rpcError(msg.id, -32603, 'Erreur interne');
    }
  }

  // Renvoie { status, body } ; body null = 202 sans contenu.
  return async function handle(payload, ctx) {
    if (Array.isArray(payload)) {
      const out = (await Promise.all(payload.map((m) => handleOne(m, ctx)))).filter(Boolean);
      return out.length ? { status: 200, body: out } : { status: 202, body: null };
    }
    const out = await handleOne(payload, ctx);
    return out ? { status: 200, body: out } : { status: 202, body: null };
  };
}
