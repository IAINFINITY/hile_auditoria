import { parseLooseJsonObject } from "@/lib/json/looseJson";

function tryParseJson(text) {
  return parseLooseJsonObject(text);
}

function toArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item === null || item === undefined) return "";

      if (typeof item === "string") return item.trim();
      if (typeof item === "number" || typeof item === "boolean") return String(item);

      if (typeof item === "object") {
        const flatEntries = Object.entries(item).filter(
          ([, fieldValue]) =>
            fieldValue !== null &&
            fieldValue !== undefined &&
            (typeof fieldValue === "string" || typeof fieldValue === "number" || typeof fieldValue === "boolean"),
        );

        if (flatEntries.length > 0) {
          return flatEntries
            .map(([fieldKey, fieldValue]) => `${fieldKey}: ${String(fieldValue)}`)
            .join(" | ");
        }

        try {
          return JSON.stringify(item);
        } catch {
          return String(item);
        }
      }

      return String(item).trim();
    })
    .filter(Boolean);
}

function pickFirstText(source, keys) {
  if (!source || typeof source !== "object") return "";
  for (const key of keys) {
    const value = source[key];
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeSeverity(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (!value) return "Não informado";
  if (value.startsWith("crit") || value === "critical") return "Crítico";
  if (value.startsWith("alt") || value === "high") return "Alto";
  if (value.startsWith("med") || value === "medium") return "Médio";
  if (value.startsWith("baix") || value === "low") return "Baixo";
  if (value.startsWith("info")) return "Informativo";
  return String(raw).trim();
}

function normalizeGapName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function toChatwootAppBase(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const cleanedPath = parsed.pathname
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
    return `${parsed.origin}${cleanedPath}`.replace(/\/+$/, "");
  } catch {
    return raw
      .replace(/\/+$/, "")
      .replace(/\/api\/v1(?:\/.*)?$/i, "")
      .replace(/\/api(?:\/.*)?$/i, "");
  }
}

function buildConversationLink(baseUrl, accountId, inboxId, conversationId) {
  if (!baseUrl || !accountId || !inboxId || !conversationId) return null;
  return `${baseUrl}/app/accounts/${accountId}/inbox/${inboxId}/conversations/${conversationId}`;
}

function extractGapEntriesFromAnalysis(item) {
  const parsed = tryParseJson(item?.analysis?.answer);
  const gapsRaw = Array.isArray(parsed?.gaps_operacionais) ? parsed.gaps_operacionais : [];
  const contactName = item?.contact?.name || item?.contact?.identifier || item?.contact_key || "Contato sem nome";

  return gapsRaw.map((rawGap, index) => {
    if (typeof rawGap === "string") {
      const text = rawGap.trim();
      return {
        name: text || `Gap ${index + 1}`,
        severity: "Não informado",
        description: text || "Não informado",
        messageReference: "Não informado",
        userReportedData: "",
        accessInfinityConfirmedData: "",
        contactName,
      };
    }

    if (!rawGap || typeof rawGap !== "object") {
      return {
        name: `Gap ${index + 1}`,
        severity: "Não informado",
        description: "Não informado",
        messageReference: "Não informado",
        userReportedData: "",
        accessInfinityConfirmedData: "",
        contactName,
      };
    }

    const name =
      pickFirstText(rawGap, ["nome_gap", "nome", "titulo", "title", "gap", "categoria"]) ||
      `Gap ${index + 1} - ${contactName}`;
    const severity = normalizeSeverity(
      pickFirstText(rawGap, ["severidade", "severity", "nivel", "prioridade", "priority"]),
    );
    const description =
      pickFirstText(rawGap, ["descricao", "description", "detalhe", "detalhes", "contexto"]) || "Não informado";
    const messageReference =
      pickFirstText(rawGap, [
        "mensagem_referencia",
        "message_reference",
        "referencia_mensagem",
        "trecho",
        "timestamp",
        "referencia",
      ]) || "Não informado";
    const userReportedData = pickFirstText(rawGap, [
      "dado_informado_pelo_usuario",
      "dado_informado_usuario",
      "dado_informado",
      "valor_informado",
    ]);
    const accessInfinityConfirmedData = pickFirstText(rawGap, [
      "dado_confirmado_pelo_acesso_infinity",
      "dado_confirmado_acesso_infinity",
      "dado_confirmado",
      "valor_confirmado",
    ]);

    return {
      name,
      severity,
      description,
      messageReference,
      userReportedData,
      accessInfinityConfirmedData,
      contactName,
    };
  });
}

function buildGapSection(gap) {
  const lines = [];
  lines.push(`### ${gap.name}`);
  lines.push(`- **Contato:** ${gap.contactName || "Não informado"}`);
  lines.push(`- **Severidade:** ${gap.severity}`);
  lines.push(`- **Descrição:** ${gap.description}`);
  lines.push(`- **Mensagem de referência:** ${gap.messageReference}`);

  if (gap.userReportedData || gap.accessInfinityConfirmedData) {
    lines.push(
      `- **Dado informado pelo usuário:** ${gap.userReportedData || "Não informado"} *(somente para gaps de dado incorreto)*`,
    );
    lines.push(
      `- **Dado confirmado pelo Acesso Infinity:** ${gap.accessInfinityConfirmedData || "Não informado"} *(somente para gaps de dado incorreto)*`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function resolveStatusLabel(parsed, gaps, firstState) {
  const parsedStatus = String(parsed?.status_encerramento || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const hasAbandonmentGap = gaps.some((gap) => normalizeGapName(gap.name).includes("abandono"));

  if (parsedStatus === "abandonado" || hasAbandonmentGap) {
    return "**Abandonado**";
  }
  if (parsedStatus === "aguardando_retorno_cliente") {
    return "**Aguardando retorno do cliente**";
  }
  if (parsedStatus === "sem_resposta") {
    return "**Sem resposta**";
  }

  if (firstState) {
    if (firstState.finalization_status === "finalizada") {
      if (firstState.finalization_actor) {
        return `**Finalizada por ${firstState.finalization_actor}**`;
      }
      return `**Finalizada (${firstState.finalization_reason || "motivo não informado"})**`;
    }
    if (firstState.waiting_on_agent) return "**Aguardando resposta da IA/atendente**";
    if (firstState.waiting_on_customer) return "**Aguardando retorno do cliente**";
    return "**Em andamento**";
  }

  return "**Estado não identificado**";
}

function resolveSummary(parsed, item, gaps) {
  const summary = String(parsed?.resumo || "").trim();
  if (summary) return summary;

  const context = toArray(parsed?.contexto_informativo);
  if (context.length > 0) return context[0];

  if (gaps.length > 0) {
    return `Ocorreram ${gaps.length} gap(s) operacional(is) com evidência nesta conversa.`;
  }

  if (Number(item?.message_count_day || 0) === 0) {
    return "Sem mensagens do dia para este contato no recorte selecionado.";
  }

  return "Sem evidência textual suficiente para montar resumo nesta execução.";
}

function buildItemSection(
  item,
  index,
  options: {
    chatwootAppBase?: string;
    accountId?: number | null;
    inboxId?: number | null;
  } = {},
) {
  const parsed = tryParseJson(item?.analysis?.answer);
  const contactName = item?.contact?.name || item?.contact?.identifier || item?.contact_key || "Contato sem nome";
  const melhorias = toArray(parsed?.pontos_melhoria);
  const gaps = extractGapEntriesFromAnalysis(item);
  const proximos = toArray(parsed?.proximos_passos);
  const risco = Boolean(parsed?.risco_critico || gaps.some((gap) => normalizeSeverity(gap.severity) === "Crítico"));
  const links = (item?.conversation_ids || [])
    .map((conversationId) =>
      buildConversationLink(options.chatwootAppBase, options.accountId, options.inboxId, Number(conversationId)),
    )
    .filter(Boolean);
  const operational = Array.isArray(item?.conversation_operational) ? item.conversation_operational : [];
  const firstState = operational[0]?.state || null;
  const finalizationLabel = resolveStatusLabel(parsed, gaps, firstState);
  const resumo = resolveSummary(parsed, item, gaps);

  const lines = [];
  lines.push(`### ${index}. ${contactName}`);
  lines.push(`- **Contact key:** \`${item?.contact_key}\``);
  lines.push(`- **Conversas:** ${item?.conversation_ids?.join(", ") || "-"}`);
  lines.push(`- **Links das conversas:** ${links.length > 0 ? links.join(" | ") : "Não disponível"}`);
  lines.push(`- **Mensagens no dia:** ${item?.message_count_day || 0}`);
  lines.push(`- **Status operacional:** ${finalizationLabel}`);
  lines.push(`- **Risco crítico:** ${risco ? "Sim" : "Não"}`);
  lines.push(`- **Resumo:** ${resumo}`);
  lines.push(`- **Pontos de melhoria:** ${melhorias.length > 0 ? melhorias.join(" | ") : "Nenhum apontado"}`);
  lines.push(`- **Gaps operacionais identificados:** ${gaps.length}`);
  lines.push(`- **Próximos passos:** ${proximos.length > 0 ? proximos.join(" | ") : "Nenhum apontado"}`);
  lines.push("");
  return lines.join("\n");
}

export { buildGapSection, buildItemSection, extractGapEntriesFromAnalysis, toArray, toChatwootAppBase, tryParseJson };
