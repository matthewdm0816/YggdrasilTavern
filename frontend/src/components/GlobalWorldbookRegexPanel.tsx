import { useEffect, useRef, useState, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, RefreshCcw, Save } from "lucide-react";
import { api, GlobalWorldbookRegexConfig, RegexRule, WorldBook } from "../lib/api";
import { regexRulesFromPreset } from "../lib/prompt";
import { validateRegex } from "../lib/regex";
import { CollapsibleSection } from "./CollapsibleSection";
import { RegexRulesSection } from "./RegexRulesSection";

// Shared by the editor and the chat display. Like the global Prompt, it is only
// refetched explicitly so a background refresh cannot hide a revision conflict.
export const globalWorldbookRegexQuery = {
  queryKey: ["global-worldbook-regex-config"],
  queryFn: api.globalWorldbookRegexConfig,
  staleTime: Infinity,
  refetchOnWindowFocus: false
};

export type WorldbookRegexSettings = { worldbookIds: string[]; regexRules: RegexRule[] };

const emptySettings: WorldbookRegexSettings = { worldbookIds: [], regexRules: [] };

export function settingsFromConfig(config: GlobalWorldbookRegexConfig): WorldbookRegexSettings {
  return {
    worldbookIds: [...config.worldbook_ids],
    regexRules: regexRulesFromPreset({ regex_rules: config.regex_rules })
  };
}

function sameSettings(left: WorldbookRegexSettings, right: WorldbookRegexSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

type Props = { worldbooks: WorldBook[]; onError?: (message: string) => void };

export function GlobalWorldbookRegexPanel({ worldbooks, onError }: Props) {
  const queryClient = useQueryClient();
  const configQuery = useQuery(globalWorldbookRegexQuery);
  const [draft, setDraft] = useState<WorldbookRegexSettings>(emptySettings);
  const [saved, setSaved] = useState<WorldbookRegexSettings>(emptySettings);
  const savedRef = useRef<WorldbookRegexSettings>(emptySettings);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [feedback, setFeedback] = useState<{ saved: boolean; error?: string } | null>(null);
  const hasChanges = !sameSettings(draft, saved);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const invalidRegexCount = draft.regexRules.filter((rule) => validateRegex(rule)).length;

  function adopt(config: GlobalWorldbookRegexConfig, replaceDraft: (current: WorldbookRegexSettings, incoming: WorldbookRegexSettings) => WorldbookRegexSettings) {
    const incoming = settingsFromConfig(config);
    setDraft((current) => replaceDraft(current, incoming));
    setSaved(incoming);
    savedRef.current = incoming;
    setRevision(config.revision);
  }

  useEffect(() => {
    // An untouched draft follows the server. Unsaved edits keep their old revision,
    // so saving them over a newer server version still reports a conflict.
    if (configQuery.data && sameSettings(draftRef.current, savedRef.current)) {
      adopt(configQuery.data, (_current, incoming) => incoming);
    }
  }, [configQuery.data]);

  function setRegexRules(update: SetStateAction<RegexRule[]>) {
    setDraft((current) => ({ ...current, regexRules: typeof update === "function" ? update(current.regexRules) : update }));
  }

  function toggleWorldbook(worldbookId: string) {
    setDraft((current) => ({
      ...current,
      worldbookIds: current.worldbookIds.includes(worldbookId)
        ? current.worldbookIds.filter((item) => item !== worldbookId)
        : [...current.worldbookIds, worldbookId]
    }));
  }

  async function save() {
    if (!hasChanges || invalidRegexCount || configQuery.isPending || configQuery.error || savingRef.current) return;
    const submitted = draft;
    savingRef.current = true;
    setSaving(true);
    setFeedback(null);
    try {
      const result = await api.updateGlobalWorldbookRegexConfig({
        worldbook_ids: submitted.worldbookIds,
        regex_rules: submitted.regexRules,
        expected_revision: revision
      });
      adopt(result, (current, incoming) => sameSettings(current, submitted) ? incoming : current);
      queryClient.setQueryData(globalWorldbookRegexQuery.queryKey, result);
      setFeedback({ saved: true });
      try {
        await queryClient.invalidateQueries({ queryKey: ["context-preview"] }, { throwOnError: true });
      } catch (cause) {
        const message = `全局世界书与 Regex 已保存，但刷新上下文失败：${errorDetail(cause)}`;
        setFeedback({ saved: true, error: message });
        onError?.(message);
      }
    } catch (cause) {
      const message = `全局世界书与 Regex 保存失败：${errorDetail(cause)}`;
      setFeedback({ saved: false, error: message });
      onError?.(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reloadFromServer() {
    setFeedback(null);
    const result = await configQuery.refetch();
    if (result.data) adopt(result.data, (_current, incoming) => incoming);
  }

  return (
    <>
      <CollapsibleSection
        contentId="inspector-worldbooks-content"
        title="全局世界书"
        icon={<BookOpen size={16} />}
        storageKey="yggdrasil-tavern.inspector.worldbooks.expanded"
        className="inspector-section"
        headerMeta={draft.worldbookIds.length > 0 ? <span className="quiet-badge">已启用 {draft.worldbookIds.length}</span> : undefined}
      >
        <div className="check-list">
          {worldbooks.map((book) => <label key={book.id}><input type="checkbox" checked={draft.worldbookIds.includes(book.id)} onChange={() => toggleWorldbook(book.id)} />{book.name}</label>)}
          {!worldbooks.length && <p className="muted">尚无世界书。</p>}
        </div>
      </CollapsibleSection>
      <RegexRulesSection regexRules={draft.regexRules} setRegexRules={setRegexRules} />
      {configQuery.error && <p className="field-error" role="alert">全局世界书与 Regex 读取失败：{errorDetail(configQuery.error)}</p>}
      <div className="inspector-save-area">
        <button
          type="button"
          className={`${hasChanges ? "primary-button" : "secondary-button"} inspector-save`}
          disabled={!hasChanges || saving || invalidRegexCount > 0 || configQuery.isPending || Boolean(configQuery.error)}
          onClick={() => void save()}
        ><Save size={16} />{saving ? "保存中…" : "保存世界书与 Regex"}</button>
        {(saving || hasChanges || feedback?.saved) && <p className="save-feedback" role="status" aria-live="polite">
          {saving ? "保存中…" : hasChanges ? "有未保存修改，对所有会话生效。" : "已保存，对所有会话生效。"}
        </p>}
        {feedback?.error && <p className="field-error" role="alert">{feedback.error}</p>}
        {feedback?.saved === false && <button className="secondary-button" type="button" onClick={() => void reloadFromServer()}>
          <RefreshCcw size={15} />放弃本地修改并重新读取
        </button>}
      </div>
    </>
  );
}
