import type { ChatwootContact, NormalizedConversationLog, NormalizedMessage } from "./types";

function normalizeSenderType(rawType: unknown): string {
  return String(rawType || "").toLowerCase();
}

function pickStatusFromAttributes(attributes: any): string {
  if (!attributes || typeof attributes !== "object") return "";

  const direct = String(
    attributes?.status || attributes?.current_status || attributes?.state || attributes?.conversation_status || "",
  ).trim();
  if (direct) return direct;

  const changedStatus = attributes?.changed_attributes?.status;
  if (Array.isArray(changedStatus) && changedStatus.length > 0) {
    return String(changedStatus[changedStatus.length - 1] || "").trim();
  }

  return "";
}

function textFromActivityMessage(message: any): string {
  const attributes = message?.content_attributes || {};
  const event = String(attributes?.event || attributes?.type || attributes?.action || "").trim();
  const status = pickStatusFromAttributes(attributes);
  const actor =
    message?.sender?.name ||
    message?.sender?.available_name ||
    attributes?.actor?.name ||
    attributes?.performed_by?.name ||
    "";

  if (status) {
    const normalizedStatus = status.toLowerCase();
    if (normalizedStatus === "resolved" || normalizedStatus === "closed") {
      return actor
        ? `Conversa foi marcada como resolvida por ${actor}.`
        : "Conversa foi marcada como resolvida.";
    }
    return actor ? `Status alterado para "${status}" por ${actor}.` : `Status alterado para "${status}".`;
  }

  if (event) {
    return actor ? `Evento do sistema (${event}) por ${actor}.` : `Evento do sistema (${event}).`;
  }

  return actor ? `Atividade do sistema registrada por ${actor}.` : "[atividade do sistema]";
}

function resolveRole(message: any): string {
  if (message?.private) return "SYSTEM_PRIVATE";

  const senderType = normalizeSenderType(message?.sender_type || message?.sender?.type);
  const messageType = Number(message?.message_type);

  if (messageType === 0 || senderType === "contact") return "USER";
  if (messageType === 1 || senderType === "user" || senderType === "agent") return "AGENT";

  return "SYSTEM";
}

function textFromMessage(message: any): string {
  const content = (message?.content || "").trim();
  if (content) return content;

  const messageType = Number(message?.message_type);
  if (messageType === 2) {
    return textFromActivityMessage(message);
  }

  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (attachments.length > 0) {
    return `[anexo] ${attachments.length} arquivo(s)`;
  }

  return "[mensagem sem conteudo textual]";
}

function normalizeMessage(message: any): NormalizedMessage {
  return {
    id: Number(message?.id || 0),
    created_at: Number(message?.created_at || 0),
    role: resolveRole(message),
    sender_name: message?.sender?.name || message?.sender?.available_name || null,
    sender_id: Number(message?.sender_id || message?.sender?.id || 0) || null,
    text: textFromMessage(message),
    raw_message_type: Number(message?.message_type || -1),
    private: Boolean(message?.private),
  };
}

function extractLabels(conversation: any): string[] {
  const candidates: unknown[] = [
    conversation?.labels,
    conversation?.meta?.labels,
    conversation?.meta?.conversation?.labels,
    conversation?.additional_attributes?.labels,
    conversation?.meta?.additional_attributes?.labels,
  ];

  const merged = new Set<string>();
  for (const entry of candidates) {
    if (!Array.isArray(entry)) continue;
    for (const label of entry) {
      const clean = String(label || "").trim();
      if (clean) merged.add(clean);
    }
  }

  return Array.from(merged);
}

export function extractContact(conversation: any): ChatwootContact {
  const sender = conversation?.meta?.sender;
  if (sender) {
    return {
      id: Number(sender.id || 0) || null,
      name: sender.name || null,
      identifier: sender.identifier || sender.phone_number || sender.email || null,
    };
  }

  const contactPayload = conversation?.meta?.contact?.payload;
  if (Array.isArray(contactPayload) && contactPayload.length > 0) {
    const contact = contactPayload[0];
    return {
      id: Number(contact?.id || 0) || null,
      name: contact?.name || null,
      identifier: contact?.identifier || contact?.phone_number || null,
    };
  }

  const directContact = conversation?.contact;
  if (directContact) {
    return {
      id: Number(directContact?.id || 0) || null,
      name: directContact?.name || null,
      identifier: directContact?.identifier || directContact?.phone_number || null,
    };
  }

  return {
    id: Number(conversation?.contact_inbox?.contact_id || 0) || null,
    name: null,
    identifier: conversation?.contact_inbox?.source_id || null,
  };
}

export function mergeConversationMessages(conversation: any, endpointMessages: any[]): any[] {
  const conversationMessages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const endpointList = Array.isArray(endpointMessages) ? endpointMessages : [];

  const byId = new Map(endpointList.map((item) => [item.id, item]));

  const merged = conversationMessages.map((item: any) => ({
    ...byId.get(item.id),
    ...item,
  }));

  for (const item of endpointList) {
    if (!merged.some((existing: any) => existing.id === item.id)) {
      merged.push(item);
    }
  }

  return merged;
}

export function normalizeConversationLog({ conversation, messages }: { conversation: any; messages: any[] }): NormalizedConversationLog {
  const allMessages = mergeConversationMessages(conversation, messages)
    .map(normalizeMessage)
    .filter((item) => item.created_at > 0)
    .sort((a, b) => a.created_at - b.created_at);

  return {
    conversation_id: Number(conversation?.id || 0),
    status: conversation?.status || null,
    created_at: Number(conversation?.created_at || 0),
    updated_at: Number(conversation?.updated_at || 0),
    last_activity_at: Number(conversation?.last_activity_at || 0),
    timestamp: Number(conversation?.timestamp || 0),
    unread_count: Number(conversation?.unread_count || 0),
    inbox_id: Number(conversation?.inbox_id || 0),
    labels: extractLabels(conversation),
    contact: extractContact(conversation),
    messages: allMessages,
    total_messages_all_time: allMessages.length,
    total_messages_day: allMessages.length,
  };
}

export function attachDay(messages: NormalizedMessage[], getDateInTz: (unixSeconds: number) => string): NormalizedMessage[] {
  return messages.map((item) => ({
    ...item,
    date_ymd: getDateInTz(item.created_at),
  }));
}

export function renderLogForPrompt(log: { messages: NormalizedMessage[] }): string {
  const lines = log.messages.map((item) => {
    const date = new Date(item.created_at * 1000).toISOString();
    const sender = item.sender_name ? ` (${item.sender_name})` : "";
    const conversation = item.conversation_id ? ` [conv:${item.conversation_id}]` : "";
    return `[${date}]${conversation} ${item.role}${sender}: ${item.text}`;
  });

  return lines.join("\n");
}

