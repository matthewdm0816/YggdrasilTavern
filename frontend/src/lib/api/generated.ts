export interface paths {
    "/api/auth/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Auth Status */
        get: operations["auth_status_api_auth_status_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/login": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Login */
        post: operations["login_api_auth_login_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Logout */
        post: operations["logout_api_auth_logout_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_api_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-profiles/models/discover": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Discover Api Profile Models */
        post: operations["discover_api_profile_models_api_api_profiles_models_discover_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-profiles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Api Profiles */
        get: operations["list_api_profiles_api_api_profiles_get"];
        put?: never;
        /** Create Api Profile */
        post: operations["create_api_profile_api_api_profiles_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-profiles/{profile_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Api Profile */
        delete: operations["delete_api_profile_api_api_profiles__profile_id__delete"];
        options?: never;
        head?: never;
        /** Update Api Profile */
        patch: operations["update_api_profile_api_api_profiles__profile_id__patch"];
        trace?: never;
    };
    "/api/api-profiles/{profile_id}/models/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Refresh Api Profile Models */
        post: operations["refresh_api_profile_models_api_api_profiles__profile_id__models_refresh_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/imports/sillytavern/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Preview Import */
        post: operations["preview_import_api_imports_sillytavern_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/imports/sillytavern/apply": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Commit Import */
        post: operations["commit_import_api_imports_sillytavern_apply_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/imports/resources": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Imported Resources */
        get: operations["imported_resources_api_imports_resources_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/saved-credentials": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Saved Credentials */
        get: operations["saved_credentials_api_saved_credentials_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/api-profiles/{profile_id}/credential": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Bind Credential */
        post: operations["bind_credential_api_api_profiles__profile_id__credential_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/session-defaults": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Session Defaults */
        get: operations["session_defaults_api_settings_session_defaults_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/settings/prompt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Global Prompt Config */
        get: operations["get_global_prompt_config_api_settings_prompt_get"];
        /** Update Global Prompt Config */
        put: operations["update_global_prompt_config_api_settings_prompt_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Characters */
        get: operations["list_characters_api_characters_get"];
        put?: never;
        /** Create Character */
        post: operations["create_character_api_characters_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Character */
        post: operations["import_character_api_characters_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/import/chub": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Chub Character */
        post: operations["import_chub_character_api_characters_import_chub_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/characters/{character_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Character */
        get: operations["get_character_api_characters__character_id__get"];
        put?: never;
        post?: never;
        /** Delete Character */
        delete: operations["delete_character_api_characters__character_id__delete"];
        options?: never;
        head?: never;
        /** Update Character */
        patch: operations["update_character_api_characters__character_id__patch"];
        trace?: never;
    };
    "/api/characters/{character_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export Character */
        get: operations["export_character_api_characters__character_id__export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worldbooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Worldbooks */
        get: operations["list_worldbooks_api_worldbooks_get"];
        put?: never;
        /** Create Worldbook */
        post: operations["create_worldbook_api_worldbooks_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worldbooks/import": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Worldbook */
        post: operations["import_worldbook_api_worldbooks_import_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worldbooks/import/chub": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Import Chub Worldbook */
        post: operations["import_chub_worldbook_api_worldbooks_import_chub_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/worldbooks/{worldbook_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Worldbook */
        delete: operations["delete_worldbook_api_worldbooks__worldbook_id__delete"];
        options?: never;
        head?: never;
        /** Update Worldbook */
        patch: operations["update_worldbook_api_worldbooks__worldbook_id__patch"];
        trace?: never;
    };
    "/api/worldbooks/{worldbook_id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Export Worldbook */
        get: operations["export_worldbook_api_worldbooks__worldbook_id__export_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session-folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Session Folders */
        get: operations["list_session_folders_api_session_folders_get"];
        put?: never;
        /** Create Session Folder */
        post: operations["create_session_folder_api_session_folders_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/session-folders/{folder_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Session Folder */
        delete: operations["delete_session_folder_api_session_folders__folder_id__delete"];
        options?: never;
        head?: never;
        /** Update Session Folder */
        patch: operations["update_session_folder_api_session_folders__folder_id__patch"];
        trace?: never;
    };
    "/api/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Sessions */
        get: operations["list_sessions_api_sessions_get"];
        put?: never;
        /** Create Session */
        post: operations["create_session_api_sessions_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Delete Session */
        delete: operations["delete_session_api_sessions__session_id__delete"];
        options?: never;
        head?: never;
        /** Update Session */
        patch: operations["update_session_api_sessions__session_id__patch"];
        trace?: never;
    };
    "/api/sessions/{session_id}/tree": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Session Tree */
        get: operations["get_session_tree_api_sessions__session_id__tree_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/active-path": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Active Path */
        get: operations["get_active_path_api_sessions__session_id__active_path_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Append Message */
        post: operations["append_message_api_sessions__session_id__messages_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/messages/{message_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        /** Update Message */
        patch: operations["update_message_api_messages__message_id__patch"];
        trace?: never;
    };
    "/api/messages/{message_id}/select": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Select Message Endpoint */
        post: operations["select_message_endpoint_api_messages__message_id__select_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/messages/{message_id}/swipes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create Swipe Endpoint */
        post: operations["create_swipe_endpoint_api_messages__message_id__swipes_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/context/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Context Preview */
        post: operations["context_preview_api_sessions__session_id__context_preview_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/generation-runs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Generation Runs */
        get: operations["list_generation_runs_api_sessions__session_id__generation_runs_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/generation-runs/{run_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Generation Run */
        get: operations["get_generation_run_api_generation_runs__run_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/sessions/{session_id}/generate/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Generate Stream */
        post: operations["generate_stream_api_sessions__session_id__generate_stream_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** APIProfileCreate */
        APIProfileCreate: {
            /** Name */
            name: string;
            /** Provider Type */
            provider_type: string;
            /** Base Url */
            base_url: string;
            /** Path Override */
            path_override?: string | null;
            /** Model */
            model: string;
            /**
             * Api Key Env
             * @default
             */
            api_key_env: string;
            /** Default Params */
            default_params?: {
                [key: string]: unknown;
            };
            /**
             * Input Token Limit
             * @default 262144
             */
            input_token_limit: number;
            /**
             * Output Token Limit
             * @default 32768
             */
            output_token_limit: number;
            /** Api Key */
            api_key?: string | null;
        };
        /** APIProfileOut */
        APIProfileOut: {
            /** Name */
            name: string;
            /** Provider Type */
            provider_type: string;
            /** Base Url */
            base_url: string;
            /** Path Override */
            path_override?: string | null;
            /** Model */
            model: string;
            /**
             * Api Key Env
             * @default
             */
            api_key_env: string;
            /** Default Params */
            default_params?: {
                [key: string]: unknown;
            };
            /**
             * Input Token Limit
             * @default 262144
             */
            input_token_limit: number;
            /**
             * Output Token Limit
             * @default 32768
             */
            output_token_limit: number;
            /** Id */
            id: string;
            /**
             * Has Api Key
             * @default false
             */
            has_api_key: boolean;
            /** Model Catalog */
            model_catalog?: components["schemas"]["RemoteModelInfo"][];
            /** Models Refreshed At */
            models_refreshed_at?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** APIProfileUpdate */
        APIProfileUpdate: {
            /** Name */
            name?: string | null;
            /** Provider Type */
            provider_type?: string | null;
            /** Base Url */
            base_url?: string | null;
            /** Path Override */
            path_override?: string | null;
            /** Model */
            model?: string | null;
            /** Api Key */
            api_key?: string | null;
            /** Api Key Env */
            api_key_env?: string | null;
            /** Default Params */
            default_params?: {
                [key: string]: unknown;
            } | null;
            /** Input Token Limit */
            input_token_limit?: number | null;
            /** Output Token Limit */
            output_token_limit?: number | null;
        };
        /** ActivatedLore */
        ActivatedLore: {
            /** Id */
            id: string;
            /** Worldbook Id */
            worldbook_id: string;
            /** Order */
            order: number;
            /** Position */
            position: string;
            /** Content */
            content: string;
            /** Keys */
            keys: string[];
        };
        /** AuthStatus */
        AuthStatus: {
            /** Enabled */
            enabled: boolean;
            /** Authenticated */
            authenticated: boolean;
            /** Username */
            username?: string | null;
        };
        /** BindCredentialRequest */
        BindCredentialRequest: {
            /** Credential Id */
            credential_id: string;
        };
        /** Body_import_character_api_characters_import_post */
        Body_import_character_api_characters_import_post: {
            /** File */
            file: string;
        };
        /** Body_import_worldbook_api_worldbooks_import_post */
        Body_import_worldbook_api_worldbooks_import_post: {
            /** File */
            file: string;
        };
        /** CharacterCreate */
        CharacterCreate: {
            /** Name */
            name: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Personality
             * @default
             */
            personality: string;
            /**
             * Scenario
             * @default
             */
            scenario: string;
            /**
             * First Mes
             * @default
             */
            first_mes: string;
            /**
             * Mes Example
             * @default
             */
            mes_example: string;
            /**
             * Creator Notes
             * @default
             */
            creator_notes: string;
            /**
             * System Prompt
             * @default
             */
            system_prompt: string;
            /**
             * Post History Instructions
             * @default
             */
            post_history_instructions: string;
            /** Alternate Greetings */
            alternate_greetings?: string[];
            /** Tags */
            tags?: string[];
            /**
             * Creator
             * @default
             */
            creator: string;
            /**
             * Character Version
             * @default
             */
            character_version: string;
            /** Avatar Data Url */
            avatar_data_url?: string | null;
            /** Avatar Original Data Url */
            avatar_original_data_url?: string | null;
            /** Avatar Transform */
            avatar_transform?: {
                [key: string]: unknown;
            };
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            };
            /** Extensions */
            extensions?: {
                [key: string]: unknown;
            };
            /** Character Book */
            character_book?: {
                [key: string]: unknown;
            } | null;
        };
        /** CharacterOut */
        CharacterOut: {
            /** Name */
            name: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Personality
             * @default
             */
            personality: string;
            /**
             * Scenario
             * @default
             */
            scenario: string;
            /**
             * First Mes
             * @default
             */
            first_mes: string;
            /**
             * Mes Example
             * @default
             */
            mes_example: string;
            /**
             * Creator Notes
             * @default
             */
            creator_notes: string;
            /**
             * System Prompt
             * @default
             */
            system_prompt: string;
            /**
             * Post History Instructions
             * @default
             */
            post_history_instructions: string;
            /** Alternate Greetings */
            alternate_greetings?: string[];
            /** Tags */
            tags?: string[];
            /**
             * Creator
             * @default
             */
            creator: string;
            /**
             * Character Version
             * @default
             */
            character_version: string;
            /** Avatar Data Url */
            avatar_data_url?: string | null;
            /** Avatar Original Data Url */
            avatar_original_data_url?: string | null;
            /** Avatar Transform */
            avatar_transform?: {
                [key: string]: unknown;
            };
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            };
            /** Extensions */
            extensions?: {
                [key: string]: unknown;
            };
            /** Character Book */
            character_book?: {
                [key: string]: unknown;
            } | null;
            /** Id */
            id: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** CharacterSummaryOut */
        CharacterSummaryOut: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Avatar Data Url */
            avatar_data_url?: string | null;
            /** Avatar Transform */
            avatar_transform?: {
                [key: string]: unknown;
            };
            /** Tags */
            tags?: string[];
            /**
             * Creator
             * @default
             */
            creator: string;
            /**
             * Character Version
             * @default
             */
            character_version: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** CharacterUpdate */
        CharacterUpdate: {
            /** Name */
            name?: string | null;
            /** Description */
            description?: string | null;
            /** Personality */
            personality?: string | null;
            /** Scenario */
            scenario?: string | null;
            /** First Mes */
            first_mes?: string | null;
            /** Mes Example */
            mes_example?: string | null;
            /** Creator Notes */
            creator_notes?: string | null;
            /** System Prompt */
            system_prompt?: string | null;
            /** Post History Instructions */
            post_history_instructions?: string | null;
            /** Alternate Greetings */
            alternate_greetings?: string[] | null;
            /** Tags */
            tags?: string[] | null;
            /** Creator */
            creator?: string | null;
            /** Character Version */
            character_version?: string | null;
            /** Avatar Data Url */
            avatar_data_url?: string | null;
            /** Avatar Original Data Url */
            avatar_original_data_url?: string | null;
            /** Avatar Transform */
            avatar_transform?: {
                [key: string]: unknown;
            } | null;
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            } | null;
            /** Extensions */
            extensions?: {
                [key: string]: unknown;
            } | null;
            /** Character Book */
            character_book?: {
                [key: string]: unknown;
            } | null;
        };
        /** ChubImportRequest */
        ChubImportRequest: {
            /** Url Or Path */
            url_or_path: string;
        };
        /** CompiledPromptBlock */
        CompiledPromptBlock: {
            /** Slot Id */
            slot_id: string;
            /**
             * Slot Kind
             * @enum {string}
             */
            slot_kind: "main" | "world_before" | "char_description" | "char_personality" | "scenario" | "examples" | "pre_history" | "history" | "world_after" | "post_history" | "custom";
            /** Slot Name */
            slot_name: string;
            /** Source */
            source: string;
            /**
             * Role
             * @enum {string}
             */
            role: "system" | "user" | "assistant";
            /** Content */
            content: string;
            /** Token Count */
            token_count: number;
            /**
             * Is History
             * @default false
             */
            is_history: boolean;
            /** Message Id */
            message_id?: string | null;
            /**
             * Speaker
             * @default
             */
            speaker: string;
        };
        /** ContextPreviewOut */
        ContextPreviewOut: {
            /** System */
            system: string;
            /** Messages */
            messages: components["schemas"]["PromptMessage"][];
            /** Activated Lore */
            activated_lore: components["schemas"]["ActivatedLore"][];
            /** Compiled Blocks */
            compiled_blocks?: components["schemas"]["CompiledPromptBlock"][];
            /** Diagnostics */
            diagnostics?: components["schemas"]["PromptDiagnostic"][];
            /** Worldbook Ids */
            worldbook_ids?: string[];
            /**
             * Prompt Config Revision
             * @default 0
             */
            prompt_config_revision: number;
            /**
             * Configured Input Token Limit
             * @default 262144
             */
            configured_input_token_limit: number;
            /**
             * Effective Input Token Limit
             * @default 262144
             */
            effective_input_token_limit: number;
            /**
             * Configured Output Token Limit
             * @default 32768
             */
            configured_output_token_limit: number;
            /**
             * Effective Output Token Limit
             * @default 32768
             */
            effective_output_token_limit: number;
            /** Model Max Input Tokens */
            model_max_input_tokens?: number | null;
            /** Model Max Output Tokens */
            model_max_output_tokens?: number | null;
            /** Model Max Total Tokens */
            model_max_total_tokens?: number | null;
            /**
             * Estimated Input Tokens
             * @default 0
             */
            estimated_input_tokens: number;
            /**
             * Dropped History Count
             * @default 0
             */
            dropped_history_count: number;
            /**
             * Dropped History Tokens
             * @default 0
             */
            dropped_history_tokens: number;
        };
        /** ContextPreviewRequest */
        ContextPreviewRequest: {
            /** Api Profile Id */
            api_profile_id?: string | null;
        };
        /** DefaultSessionConfigOut */
        DefaultSessionConfigOut: {
            /** Preset */
            preset?: {
                [key: string]: unknown;
            };
            /** Api Profile Id */
            api_profile_id?: string | null;
        };
        /** GenerateRequest */
        GenerateRequest: {
            /** Regenerate Message Id */
            regenerate_message_id?: string | null;
            /** Api Profile Id */
            api_profile_id?: string | null;
        };
        /** GenerationRunOut */
        GenerationRunOut: {
            /** Id */
            id: string;
            /** Session Id */
            session_id: string;
            /** Output Message Id */
            output_message_id?: string | null;
            /** Profile Name */
            profile_name: string;
            /** Provider Type */
            provider_type: string;
            /** Model */
            model: string;
            /** Status */
            status: string;
            /**
             * Started At
             * Format: date-time
             */
            started_at: string;
            /** Completed At */
            completed_at?: string | null;
            /** Duration Seconds */
            duration_seconds: number;
            /** Error */
            error?: string | null;
            /** Usage Source */
            usage_source: string;
            /** Input Tokens */
            input_tokens: number;
            /** Output Tokens */
            output_tokens: number;
            /** Cached Input Tokens */
            cached_input_tokens: number;
            /** Tokens Per Second */
            tokens_per_second: number;
            /** Base Message Id */
            base_message_id?: string | null;
            /** Api Profile Id */
            api_profile_id?: string | null;
            /** Base Url */
            base_url: string;
            /** Parameters */
            parameters: {
                [key: string]: unknown;
            };
            /** Prompt Snapshot */
            prompt_snapshot: {
                [key: string]: unknown;
            };
            /** Prompt Hash */
            prompt_hash: string;
            /** First Token At */
            first_token_at?: string | null;
            /** Usage */
            usage: {
                [key: string]: unknown;
            };
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** GenerationRunSummaryOut */
        GenerationRunSummaryOut: {
            /** Id */
            id: string;
            /** Session Id */
            session_id: string;
            /** Output Message Id */
            output_message_id?: string | null;
            /** Profile Name */
            profile_name: string;
            /** Provider Type */
            provider_type: string;
            /** Model */
            model: string;
            /** Status */
            status: string;
            /**
             * Started At
             * Format: date-time
             */
            started_at: string;
            /** Completed At */
            completed_at?: string | null;
            /** Duration Seconds */
            duration_seconds: number;
            /** Error */
            error?: string | null;
            /** Usage Source */
            usage_source: string;
            /** Input Tokens */
            input_tokens: number;
            /** Output Tokens */
            output_tokens: number;
            /** Cached Input Tokens */
            cached_input_tokens: number;
            /** Tokens Per Second */
            tokens_per_second: number;
        };
        /** GlobalPromptConfigOut */
        GlobalPromptConfigOut: {
            /** Prompt Slots */
            prompt_slots: components["schemas"]["PromptSlot"][];
            /**
             * Revision
             * @default 0
             */
            revision: number;
            /** Updated At */
            updated_at?: string | null;
        };
        /** GlobalPromptConfigUpdate */
        GlobalPromptConfigUpdate: {
            /** Prompt Slots */
            prompt_slots: components["schemas"]["PromptSlot"][];
            /** Expected Revision */
            expected_revision: number;
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** ImportedResourceOut */
        ImportedResourceOut: {
            /** Id */
            id: string;
            /** Source */
            source: string;
            /** Kind */
            kind: string;
            /** Name */
            name: string;
            /** Raw Json */
            raw_json: {
                [key: string]: unknown;
            };
            /** Converted */
            converted: {
                [key: string]: unknown;
            };
            /** Warnings */
            warnings: string[];
        };
        /** LoginRequest */
        LoginRequest: {
            /** Username */
            username: string;
            /** Password */
            password: string;
        };
        /** MessageCreate */
        MessageCreate: {
            /** Role */
            role: string;
            /**
             * Speaker
             * @default
             */
            speaker: string;
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Thinking Content
             * @default
             */
            thinking_content: string;
            /**
             * Status
             * @default complete
             */
            status: string;
            /**
             * Token Count
             * @default 0
             */
            token_count: number;
            /**
             * Thinking Token Count
             * @default 0
             */
            thinking_token_count: number;
            /**
             * Cached Tokens
             * @default 0
             */
            cached_tokens: number;
            /** Provider Metadata */
            provider_metadata?: {
                [key: string]: unknown;
            };
            /** Usage */
            usage?: {
                [key: string]: unknown;
            };
            /** Error */
            error?: string | null;
            /** Parent Id */
            parent_id?: string | null;
        };
        /** MessageOut */
        MessageOut: {
            /** Role */
            role: string;
            /**
             * Speaker
             * @default
             */
            speaker: string;
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Thinking Content
             * @default
             */
            thinking_content: string;
            /**
             * Status
             * @default complete
             */
            status: string;
            /**
             * Token Count
             * @default 0
             */
            token_count: number;
            /**
             * Thinking Token Count
             * @default 0
             */
            thinking_token_count: number;
            /**
             * Cached Tokens
             * @default 0
             */
            cached_tokens: number;
            /** Provider Metadata */
            provider_metadata?: {
                [key: string]: unknown;
            };
            /** Usage */
            usage?: {
                [key: string]: unknown;
            };
            /** Error */
            error?: string | null;
            /** Id */
            id: string;
            /** Session Id */
            session_id: string;
            /** Parent Id */
            parent_id?: string | null;
            /** Selected Child Id */
            selected_child_id?: string | null;
            /** Sort Order */
            sort_order: number;
            generation_run?: components["schemas"]["GenerationRunSummaryOut"] | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** MessageUpdate */
        MessageUpdate: {
            /** Content */
            content?: string | null;
            /** Thinking Content */
            thinking_content?: string | null;
            /** Speaker */
            speaker?: string | null;
            /** Status */
            status?: string | null;
            /** Token Count */
            token_count?: number | null;
            /** Thinking Token Count */
            thinking_token_count?: number | null;
            /** Cached Tokens */
            cached_tokens?: number | null;
            /** Provider Metadata */
            provider_metadata?: {
                [key: string]: unknown;
            } | null;
            /** Usage */
            usage?: {
                [key: string]: unknown;
            } | null;
            /** Error */
            error?: string | null;
        };
        /** ModelsDiscoverIn */
        ModelsDiscoverIn: {
            /** Provider Type */
            provider_type: string;
            /** Base Url */
            base_url: string;
            /** Path Override */
            path_override?: string | null;
            /** Api Key */
            api_key?: string | null;
            /** Profile Id */
            profile_id?: string | null;
        };
        /** ModelsRefreshOut */
        ModelsRefreshOut: {
            /** Models */
            models: components["schemas"]["RemoteModelInfo"][];
            /** Refreshed At */
            refreshed_at?: string | null;
            /**
             * Available
             * @default true
             */
            available: boolean;
            /** Message */
            message?: string | null;
        };
        /** PromptDiagnostic */
        PromptDiagnostic: {
            /**
             * Level
             * @enum {string}
             */
            level: "info" | "warning" | "error";
            /** Code */
            code: string;
            /** Message */
            message: string;
            /** Slot Id */
            slot_id?: string | null;
            /** Rule Id */
            rule_id?: string | null;
            /** Match Count */
            match_count?: number | null;
        };
        /** PromptMessage */
        PromptMessage: {
            /** Role */
            role: string;
            /** Content */
            content: string;
            /**
             * Speaker
             * @default
             */
            speaker: string;
        };
        /** PromptSlot */
        PromptSlot: {
            /** Id */
            id: string;
            /**
             * Kind
             * @enum {string}
             */
            kind: "main" | "world_before" | "char_description" | "char_personality" | "scenario" | "examples" | "pre_history" | "history" | "world_after" | "post_history" | "custom";
            /** Name */
            name: string;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /**
             * Role
             * @default system
             * @enum {string}
             */
            role: "system" | "user" | "assistant";
            /** Content */
            content?: string | null;
        };
        /** RemoteModelInfo */
        RemoteModelInfo: {
            /** Id */
            id: string;
            /** Display Name */
            display_name?: string | null;
            /** Max Input Tokens */
            max_input_tokens?: number | null;
            /** Max Output Tokens */
            max_output_tokens?: number | null;
            /** Max Total Tokens */
            max_total_tokens?: number | null;
            /** Supports Reasoning */
            supports_reasoning?: boolean | null;
            /** Supports Vision */
            supports_vision?: boolean | null;
        };
        /** SavedCredentialOut */
        SavedCredentialOut: {
            /** Id */
            id: string;
            /** Name */
            name: string;
            /** Secret Type */
            secret_type: string;
        };
        /** SessionCreate */
        SessionCreate: {
            /**
             * Title
             * @default
             */
            title: string;
            /** Character Id */
            character_id: string;
            /** Api Profile Id */
            api_profile_id?: string | null;
            /** Worldbook Id */
            worldbook_id?: string | null;
            /** Folder Id */
            folder_id?: string | null;
            /**
             * Pinned
             * @default false
             */
            pinned: boolean;
            /**
             * Archived
             * @default false
             */
            archived: boolean;
            /** Preset */
            preset?: {
                [key: string]: unknown;
            };
            /** Active Root Child Id */
            active_root_child_id?: string | null;
        };
        /** SessionFolderCreate */
        SessionFolderCreate: {
            /** Name */
            name: string;
            /** Parent Id */
            parent_id?: string | null;
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
        };
        /** SessionFolderOut */
        SessionFolderOut: {
            /** Name */
            name: string;
            /** Parent Id */
            parent_id?: string | null;
            /**
             * Sort Order
             * @default 0
             */
            sort_order: number;
            /** Id */
            id: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** SessionFolderUpdate */
        SessionFolderUpdate: {
            /** Name */
            name?: string | null;
            /** Parent Id */
            parent_id?: string | null;
            /** Sort Order */
            sort_order?: number | null;
        };
        /** SessionOut */
        SessionOut: {
            /** Title */
            title: string;
            /** Character Id */
            character_id?: string | null;
            /** Api Profile Id */
            api_profile_id?: string | null;
            /** Worldbook Id */
            worldbook_id?: string | null;
            /** Folder Id */
            folder_id?: string | null;
            /**
             * Pinned
             * @default false
             */
            pinned: boolean;
            /**
             * Archived
             * @default false
             */
            archived: boolean;
            /** Preset */
            preset?: {
                [key: string]: unknown;
            };
            /** Active Root Child Id */
            active_root_child_id?: string | null;
            /** Id */
            id: string;
            /**
             * Last Activity At
             * Format: date-time
             */
            last_activity_at: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** SessionTreeOut */
        SessionTreeOut: {
            session: components["schemas"]["SessionOut"];
            /** Messages */
            messages: components["schemas"]["MessageOut"][];
            /** Active Path Ids */
            active_path_ids: string[];
        };
        /** SessionUpdate */
        SessionUpdate: {
            /** Title */
            title?: string | null;
            /** Character Id */
            character_id?: string | null;
            /** Api Profile Id */
            api_profile_id?: string | null;
            /** Worldbook Id */
            worldbook_id?: string | null;
            /** Folder Id */
            folder_id?: string | null;
            /** Pinned */
            pinned?: boolean | null;
            /** Archived */
            archived?: boolean | null;
            /** Preset */
            preset?: {
                [key: string]: unknown;
            } | null;
            /** Active Root Child Id */
            active_root_child_id?: string | null;
        };
        /** SillyTavernApplyRequest */
        SillyTavernApplyRequest: {
            /** Token */
            token: string;
            /**
             * Activate
             * @default false
             */
            activate: boolean;
        };
        /** SillyTavernImportReport */
        SillyTavernImportReport: {
            /** Source */
            source: string;
            /** Counts */
            counts: {
                [key: string]: number;
            };
            /** Already Imported */
            already_imported: {
                [key: string]: number;
            };
            /** Warnings */
            warnings: string[];
            /** Errors */
            errors: string[];
            /** Omitted */
            omitted: {
                [key: string]: unknown;
            };
            /** Can Apply */
            can_apply: boolean;
            /** Token */
            token?: string | null;
            /** Created */
            created?: {
                [key: string]: number;
            };
            /**
             * Activated
             * @default false
             */
            activated: boolean;
            /** Backup Path */
            backup_path?: string | null;
        };
        /** SillyTavernPreviewRequest */
        SillyTavernPreviewRequest: {
            /** Ssh Host */
            ssh_host: string;
            /**
             * Directory
             * @default ~/SillyTavern
             */
            directory: string;
            /**
             * User
             * @default default-user
             */
            user: string;
        };
        /** SwipeCreate */
        SwipeCreate: {
            /** Role */
            role?: string | null;
            /** Speaker */
            speaker?: string | null;
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Thinking Content
             * @default
             */
            thinking_content: string;
            /**
             * Status
             * @default complete
             */
            status: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /** WorldBookCreate */
        WorldBookCreate: {
            /** Name */
            name: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Scan Depth
             * @default 8
             */
            scan_depth: number;
            /**
             * Token Budget
             * @default 4000
             */
            token_budget: number;
            /**
             * Recursive Scanning
             * @default false
             */
            recursive_scanning: boolean;
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            };
            /** Entries */
            entries?: components["schemas"]["WorldBookEntryCreate"][];
        };
        /** WorldBookEntryCreate */
        WorldBookEntryCreate: {
            /** Uid */
            uid?: string | null;
            /** Keys */
            keys?: string[];
            /** Secondary Keys */
            secondary_keys?: string[];
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /**
             * Constant
             * @default false
             */
            constant: boolean;
            /**
             * Selective
             * @default false
             */
            selective: boolean;
            /**
             * Order
             * @default 100
             */
            order: number;
            /**
             * Position
             * @default after_char
             */
            position: string;
            /** Depth */
            depth?: number | null;
            /**
             * Case Sensitive
             * @default false
             */
            case_sensitive: boolean;
            /**
             * Match Whole Words
             * @default false
             */
            match_whole_words: boolean;
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            };
        };
        /** WorldBookEntryOut */
        WorldBookEntryOut: {
            /** Uid */
            uid?: string | null;
            /** Keys */
            keys?: string[];
            /** Secondary Keys */
            secondary_keys?: string[];
            /**
             * Content
             * @default
             */
            content: string;
            /**
             * Enabled
             * @default true
             */
            enabled: boolean;
            /**
             * Constant
             * @default false
             */
            constant: boolean;
            /**
             * Selective
             * @default false
             */
            selective: boolean;
            /**
             * Order
             * @default 100
             */
            order: number;
            /**
             * Position
             * @default after_char
             */
            position: string;
            /** Depth */
            depth?: number | null;
            /**
             * Case Sensitive
             * @default false
             */
            case_sensitive: boolean;
            /**
             * Match Whole Words
             * @default false
             */
            match_whole_words: boolean;
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            };
            /** Id */
            id: string;
            /** Worldbook Id */
            worldbook_id: string;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** WorldBookOut */
        WorldBookOut: {
            /** Name */
            name: string;
            /**
             * Description
             * @default
             */
            description: string;
            /**
             * Scan Depth
             * @default 8
             */
            scan_depth: number;
            /**
             * Token Budget
             * @default 4000
             */
            token_budget: number;
            /**
             * Recursive Scanning
             * @default false
             */
            recursive_scanning: boolean;
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            };
            /** Id */
            id: string;
            /** Entries */
            entries?: components["schemas"]["WorldBookEntryOut"][];
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
        };
        /** WorldBookUpdate */
        WorldBookUpdate: {
            /** Name */
            name?: string | null;
            /** Description */
            description?: string | null;
            /** Scan Depth */
            scan_depth?: number | null;
            /** Token Budget */
            token_budget?: number | null;
            /** Recursive Scanning */
            recursive_scanning?: boolean | null;
            /** Raw Json */
            raw_json?: {
                [key: string]: unknown;
            } | null;
            /** Entries */
            entries?: components["schemas"]["WorldBookEntryCreate"][] | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    auth_status_api_auth_status_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthStatus"];
                };
            };
        };
    };
    login_api_auth_login_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["LoginRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthStatus"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    logout_api_auth_logout_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AuthStatus"];
                };
            };
        };
    };
    health_api_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: string;
                    };
                };
            };
        };
    };
    discover_api_profile_models_api_api_profiles_models_discover_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ModelsDiscoverIn"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelsRefreshOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_api_profiles_api_api_profiles_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["APIProfileOut"][];
                };
            };
        };
    };
    create_api_profile_api_api_profiles_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["APIProfileCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["APIProfileOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_api_profile_api_api_profiles__profile_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                profile_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_api_profile_api_api_profiles__profile_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                profile_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["APIProfileUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["APIProfileOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    refresh_api_profile_models_api_api_profiles__profile_id__models_refresh_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                profile_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ModelsRefreshOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    preview_import_api_imports_sillytavern_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SillyTavernPreviewRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SillyTavernImportReport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    commit_import_api_imports_sillytavern_apply_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SillyTavernApplyRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SillyTavernImportReport"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    imported_resources_api_imports_resources_get: {
        parameters: {
            query?: {
                kind?: string;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ImportedResourceOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    saved_credentials_api_saved_credentials_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SavedCredentialOut"][];
                };
            };
        };
    };
    bind_credential_api_api_profiles__profile_id__credential_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                profile_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["BindCredentialRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["APIProfileOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    session_defaults_api_settings_session_defaults_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["DefaultSessionConfigOut"];
                };
            };
        };
    };
    get_global_prompt_config_api_settings_prompt_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GlobalPromptConfigOut"];
                };
            };
        };
    };
    update_global_prompt_config_api_settings_prompt_put: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GlobalPromptConfigUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GlobalPromptConfigOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_characters_api_characters_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterSummaryOut"][];
                };
            };
        };
    };
    create_character_api_characters_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CharacterCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_character_api_characters_import_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_import_character_api_characters_import_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_chub_character_api_characters_import_chub_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChubImportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_character_api_characters__character_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                character_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_character_api_characters__character_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                character_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_character_api_characters__character_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                character_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CharacterUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CharacterOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_character_api_characters__character_id__export_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                character_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_worldbooks_api_worldbooks_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorldBookOut"][];
                };
            };
        };
    };
    create_worldbook_api_worldbooks_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorldBookCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorldBookOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_worldbook_api_worldbooks_import_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_import_worldbook_api_worldbooks_import_post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorldBookOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    import_chub_worldbook_api_worldbooks_import_chub_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ChubImportRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorldBookOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_worldbook_api_worldbooks__worldbook_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                worldbook_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_worldbook_api_worldbooks__worldbook_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                worldbook_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["WorldBookUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorldBookOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    export_worldbook_api_worldbooks__worldbook_id__export_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                worldbook_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_session_folders_api_session_folders_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionFolderOut"][];
                };
            };
        };
    };
    create_session_folder_api_session_folders_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionFolderCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionFolderOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_session_folder_api_session_folders__folder_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                folder_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_session_folder_api_session_folders__folder_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                folder_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionFolderUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionFolderOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_sessions_api_sessions_get: {
        parameters: {
            query?: {
                folder_id?: string | null;
                search?: string | null;
                pinned?: boolean | null;
                archived?: boolean | null;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_session_api_sessions_post: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    delete_session_api_sessions__session_id__delete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: boolean;
                    };
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_session_api_sessions__session_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SessionUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_session_tree_api_sessions__session_id__tree_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionTreeOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_active_path_api_sessions__session_id__active_path_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    append_message_api_sessions__session_id__messages_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessageCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    update_message_api_messages__message_id__patch: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                message_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["MessageUpdate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["MessageOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    select_message_endpoint_api_messages__message_id__select_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                message_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionTreeOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_swipe_endpoint_api_messages__message_id__swipes_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                message_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SwipeCreate"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["SessionTreeOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    context_preview_api_sessions__session_id__context_preview_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["ContextPreviewRequest"] | null;
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ContextPreviewOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    list_generation_runs_api_sessions__session_id__generation_runs_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationRunOut"][];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_generation_run_api_generation_runs__run_id__get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                run_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["GenerationRunOut"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    generate_stream_api_sessions__session_id__generate_stream_post: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                session_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["GenerateRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": unknown;
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
}
