import type { components } from "./generated";
import type { APIProfileWrite } from "./types";

type Schema = components["schemas"];
type WithRequired<T, K extends keyof T> = Pick<T, K> & Partial<Omit<T, K>>;

/** Backend defaults allow these create requests to omit fields marked required in OpenAPI. */
export type ProfileCreateInput = APIProfileWrite &
  WithRequired<Schema["APIProfileCreate"], "name" | "provider_type" | "base_url" | "model">;
export type ProfileUpdateInput = Schema["APIProfileUpdate"];
export type CharacterCreateInput = WithRequired<Schema["CharacterCreate"], "name">;
export type CharacterUpdateInput = Schema["CharacterUpdate"];
export type WorldBookCreateInput = WithRequired<Schema["WorldBookCreate"], "name">;
export type WorldBookUpdateInput = Schema["WorldBookUpdate"];
export type FolderCreateInput = WithRequired<Schema["SessionFolderCreate"], "name">;
export type FolderUpdateInput = Schema["SessionFolderUpdate"];
export type SessionCreateInput = WithRequired<Schema["SessionCreate"], "character_id">;
export type SessionUpdateInput = Schema["SessionUpdate"];
export type MessageCreateInput = WithRequired<Schema["MessageCreate"], "role">;
export type MessageUpdateInput = Schema["MessageUpdate"];
export type SwipeCreateInput = WithRequired<Schema["SwipeCreate"], "content">;
export type PromptConfigUpdateInput = Schema["GlobalPromptConfigUpdate"];
export type ContextPreviewInput = Schema["ContextPreviewRequest"];
export type GenerateInput = Schema["GenerateRequest"];
export type ChubImportInput = Schema["ChubImportRequest"];

type Assert<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K
}[keyof T];
type ExplicitRequired<T, Defaulted extends keyof T> = Exclude<RequiredKeys<T>, Defaulted>;

/**
 * If the backend adds a required create field, this list must be reviewed.
 * The excluded fields have server defaults in the Pydantic models.
 */
export type CreateRequirementChecks = [
  Assert<Equal<ExplicitRequired<Schema["APIProfileCreate"],
    "api_key_env" | "input_token_limit" | "output_token_limit">,
    "name" | "provider_type" | "base_url" | "model">>,
  Assert<Equal<ExplicitRequired<Schema["CharacterCreate"],
    "description" | "personality" | "scenario" | "first_mes" | "mes_example" |
    "creator_notes" | "system_prompt" | "post_history_instructions" |
    "creator" | "character_version">, "name">>,
  Assert<Equal<ExplicitRequired<Schema["WorldBookCreate"],
    "description" | "scan_depth" | "token_budget" | "recursive_scanning">, "name">>,
  Assert<Equal<ExplicitRequired<Schema["SessionFolderCreate"], "sort_order">, "name">>,
  Assert<Equal<ExplicitRequired<Schema["SessionCreate"], "title" | "pinned" | "archived">,
    "character_id">>,
  Assert<Equal<ExplicitRequired<Schema["MessageCreate"],
    "speaker" | "content" | "thinking_content" | "status" |
    "token_count" | "thinking_token_count" | "cached_tokens">, "role">>,
  Assert<Equal<ExplicitRequired<Schema["SwipeCreate"], "thinking_content" | "status">,
    "content">>
];
