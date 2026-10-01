import type { components } from "./generated";
import type {
  APIProfile, AuthStatus, ChatSession, ContextPreview, Message, ProviderType,
  SessionTree
} from "./types";

type Schema = components["schemas"];
type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type ComparableKeys<A, B, Excluded extends PropertyKey> =
  Exclude<keyof A & keyof B, Excluded>;
type MutualFields<A, B, Excluded extends PropertyKey = never> =
  Exclude<{
    [K in ComparableKeys<A, B, Excluded>]:
      Equal<Exclude<A[K], undefined>, Exclude<B[K], undefined>>
  }[ComparableKeys<A, B, Excluded>], true> extends never ? true : false;
type SameKeys<A, B> = Equal<keyof A, keyof B>;

type WireProfile = Schema["APIProfileOut"];
type WireSession = Schema["SessionOut"];
type WireMessage = Schema["MessageOut"];
type WireTree = Schema["SessionTreeOut"];

/**
 * The local types model UI-required default fields. Generated OpenAPI marks
 * several of those fields optional, so compare their values after removing
 * only undefined. Role and provider unions intentionally narrow server strings.
 */
export type APIContractAssertions = [
  Assert<SameKeys<APIProfile, WireProfile>>,
  Assert<MutualFields<APIProfile, WireProfile, "provider_type">>,
  Assert<ProviderType extends WireProfile["provider_type"] ? true : false>,
  Assert<SameKeys<ChatSession, WireSession>>,
  Assert<MutualFields<ChatSession, WireSession>>,
  Assert<SameKeys<Message, WireMessage>>,
  Assert<MutualFields<Message, WireMessage, "role">>,
  Assert<Message["role"] extends WireMessage["role"] ? true : false>,
  Assert<SameKeys<SessionTree, WireTree>>,
  Assert<MutualFields<SessionTree, WireTree, "session" | "messages">>,
  Assert<Equal<SessionTree["session"], ChatSession>>,
  Assert<Equal<SessionTree["messages"][number], Message>>,
  Assert<MutualFields<AuthStatus, Schema["AuthStatus"]>>,
  Assert<MutualFields<ContextPreview, Schema["ContextPreviewOut"],
    "messages" | "activated_lore" | "compiled_blocks" | "diagnostics">>
];
