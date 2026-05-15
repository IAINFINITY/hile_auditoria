export interface ChatwootConfig {
  baseUrl: string;
  apiToken: string;
  accountId: number | null;
  groupName: string;
  inboxName: string;
  inboxId: number | null;
  inboxProvider: string;
  maxPages: number;
  requestTimeoutMs: number;
}

export interface DifyConfig {
  baseUrl: string;
  apiKey: string;
  mode: string;
  inputLogField: string;
  userPrefix: string;
  requestTimeoutMs: number;
  timezone?: string;
}

export interface AppConfig {
  port: number;
  timezone: string;
  chatwoot: ChatwootConfig;
  dify: DifyConfig;
  incremental: {
    minRelevanceScore: number;
    unansweredMinutesThreshold: number;
    fullRebaseDays: number;
  };
}

export interface ErrorWithMeta extends Error {
  status?: number;
  code?: string | null;
  body?: string;
}

export interface ChatwootContact {
  id: number | null;
  name: string | null;
  identifier: string | null;
}

export interface NormalizedMessage {
  id: number;
  created_at: number;
  role: string;
  sender_name: string | null;
  sender_id: number | null;
  text: string;
  raw_message_type: number;
  private: boolean;
  date_ymd?: string;
  conversation_id?: number;
}

export interface NormalizedConversationLog {
  conversation_id: number;
  status: string | null;
  created_at: number;
  updated_at: number;
  last_activity_at: number;
  timestamp: number;
  unread_count: number;
  inbox_id: number;
  labels: string[];
  contact: ChatwootContact;
  messages: NormalizedMessage[];
  total_messages_all_time: number;
  total_messages_day: number;
}

export interface ContactLog {
  analysis_key: string;
  contact_key: string;
  contact: ChatwootContact;
  conversation_ids: number[];
  messages: NormalizedMessage[];
  message_count_day: number;
}

export interface DailyLogsSnapshot {
  date: string;
  timezone: string;
  account: { id: number; name: string | null; role: string | null };
  inbox: {
    id: number;
    name: string | null;
    provider: string | null;
    channel_type: string | null;
    phone_number: string | null;
  };
  total_conversations_in_inbox_scan: number;
  conversations_entered_today: number;
  unique_contacts_today: number;
  logs_by_conversation: NormalizedConversationLog[];
  contact_logs: ContactLog[];
}
